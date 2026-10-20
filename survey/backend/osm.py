import json
import logging
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from survey.backend.database import connect

log = logging.getLogger("karwan")

USER_AGENT = "Karwan/0.1 (hobby trailhead visit form)"
ENDPOINTS = (
    "https://overpass.openstreetmap.fr/api/interpreter",
)
TIME_URL = "https://timeapi.io/api/timezone/coordinate"
PLACE_URL = "https://nominatim.openstreetmap.org/search"
NAME_OK = re.compile(r"[A-Za-z0-9][A-Za-z0-9 '&.,-]{1,58}$")
TRAIL_LOT_RE = re.compile(
    r"\b(trail|trailhead|hike|hiking|park|falls|lake|peak|mount|mt|creek|river|"
    r"pass|sno-park|camp|campground|forest|recreation|overlook|viewpoint|gorge|"
    r"basin|meadow|ridge|glacier|wilderness|natural\s+area|conservation|day\s+use)\b",
    re.I,
)
PARK_AGENCY_RE = re.compile(
    r"(natural\s+resources|\bdnr\b|national\s+park|\bnps\b|forest\s+service|\busfs\b|"
    r"state\s+parks?|county\s+parks?|fish\s+and\s+wildlife|preservation|conservation|recreation)",
    re.I,
)
NON_TRAIL_RE = re.compile(
    r"(park\s*(&|and)\s*ride|school|district|church|hospital|clinic|bank|inn|hotel|"
    r"motel|lumber|motors|travel\s*center|apartments?|grange|grocery|market|plaza|mall)",
    re.I,
)
WEEK = 7 * 24 * 3600
YEAR = 365 * 24 * 3600


class MapLookupFailed(Exception):
    pass


def _recall(key, allow_stale=False):
    with connect() as conn:
        if allow_stale:
            row = conn.execute(
                "SELECT payload FROM osm_cache WHERE key = ?",
                (key,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT payload FROM osm_cache WHERE key = ? AND expires_at > ?",
                (key, time.time()),
            ).fetchone()
    if row is None:
        return None
    return json.loads(row["payload"])


def _remember_many(pairs, seconds):
    if not pairs:
        return
    expires = time.time() + seconds
    with connect() as conn:
        conn.executemany(
            """
            INSERT INTO osm_cache (key, payload, expires_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              payload = excluded.payload,
              expires_at = excluded.expires_at
            """,
            [(key, json.dumps(value), expires) for key, value in pairs],
        )


def _remember(key, value, seconds):
    _remember_many([(key, value)], seconds)


def _snap(value, step, up):
    scaled = value / step
    snapped = math.ceil(scaled - 1e-9) if up else math.floor(scaled + 1e-9)
    return round(snapped * step, 4)


def _element_rows(elements):
    rows = []
    for element in elements:
        osm_type = element.get("type")
        osm_id = element.get("id")
        if osm_type and osm_id is not None:
            rows.append((f"el:{osm_type}:{osm_id}", element))
    return rows


def _get(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "en",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode())


def _overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(
        ENDPOINTS[0],
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        log.warning("map lookup status=%s", exc.code)
        payload = None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        payload = None
    if payload and "elements" in payload:
        return payload["elements"]
    log.warning("map lookup failed")
    raise MapLookupFailed


def _point(element):
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def _kilometers(lat1, lon1, lat2, lon2):
    radius = 6371.0
    first, second = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    chord = (
        math.sin(dlat / 2) ** 2
        + math.cos(first) * math.cos(second) * math.sin(dlon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(chord))


def _kind(tags):
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("highway") == "trailhead":
        return "trailhead"
    return None


def _facts(tags):
    facts = []
    fee = tags.get("fee")
    if fee == "yes":
        facts.append("Fee required")
    elif fee == "no":
        facts.append("No fee listed")
    capacity = tags.get("capacity")
    if capacity and str(capacity).isdigit():
        facts.append(f"About {int(capacity)} spaces")
    if tags.get("opening_hours"):
        facts.append(tags["opening_hours"])
    if tags.get("surface"):
        surface = tags["surface"].replace("_", " ").capitalize()
        facts.append(f"{surface} surface")
    if tags.get("toilets") == "yes":
        facts.append("Bathrooms are listed")
    return facts


def _label(tags):
    english = (tags.get("name:en") or "").strip()
    local = (tags.get("name") or "").strip()
    return english or local


def _pin(element):
    tags = element.get("tags") or {}
    kind = _kind(tags)
    point = _point(element)
    if kind is None or point is None:
        return None
    name = _label(tags)
    return {
        "osm_type": element.get("type"),
        "osm_id": str(element.get("id")),
        "name": name or None,
        "lat": point[0],
        "lon": point[1],
        "kind": kind,
        "facts": _facts(tags),
        "named": bool(name),
        "operator": (tags.get("operator") or "").strip() or None,
    }


def _route_anchors(elements):
    anchors = []
    for element in elements:
        tags = element.get("tags") or {}
        if tags.get("route") not in {"hiking", "foot", "bicycle"}:
            continue
        point = _point(element)
        name = _label(tags)
        if point is None or not name:
            continue
        anchors.append({
            "lat": point[0],
            "lon": point[1],
            "name": name,
            "named": True,
        })
    return anchors


def _keep_trail_parking_lots(lots, trailheads, route_anchors):
    kept = []
    for lot in lots:
        near_trail = None
        near_any = False
        near_km = 0.45
        for th in trailheads:
            km = _kilometers(lot["lat"], lot["lon"], th["lat"], th["lon"])
            if km <= 0.45:
                near_any = True
            if th["named"] and km < near_km:
                near_km = km
                near_trail = th["name"]
        for route in route_anchors:
            km = _kilometers(lot["lat"], lot["lon"], route["lat"], route["lon"])
            if km <= 0.45:
                near_any = True
            if km < near_km:
                near_km = km
                near_trail = route["name"]
        has_trail_name = bool(TRAIL_LOT_RE.search(lot["name"] or ""))
        has_park_agency = bool(PARK_AGENCY_RE.search(lot.get("operator") or ""))
        if not (near_any or has_trail_name or has_park_agency):
            continue
        if not near_trail and (has_trail_name or has_park_agency):
            best_km = 1.5
            for th in trailheads:
                km = _kilometers(lot["lat"], lot["lon"], th["lat"], th["lon"])
                if th["named"] and km < best_km:
                    best_km = km
                    near_trail = th["name"]
        lot["near_trail"] = near_trail
        kept.append(lot)
    return kept


def _excluded_parking(tags, name):
    access = (tags.get("access") or "").lower()
    if access in {"private", "customers", "no", "permit", "employees", "residents"}:
        return True
    op_type = (tags.get("operator:type") or "").lower()
    if op_type in {"private", "business", "private_non_profit", "religious", "school"}:
        return True
    parking_type = (tags.get("parking") or "").lower()
    if tags.get("park_ride") == "yes" or parking_type in {
        "multi-storey",
        "underground",
        "carports",
        "garage_boxes",
        "lane",
    }:
        return True
    operator = tags.get("operator") or ""
    if NON_TRAIL_RE.search(operator) or NON_TRAIL_RE.search(name or ""):
        return True
    return False


def _town_name(elements, lat, lon):
    closest = None
    closest_km = None
    for element in elements:
        tags = element.get("tags") or {}
        if tags.get("place") not in {"town", "city"} or _kind(tags):
            continue
        point = _point(element)
        label = _label(tags)
        if point is None or not label or not re.search(r"[A-Za-z]", label):
            continue
        distance = _kilometers(lat, lon, point[0], point[1])
        if closest_km is None or distance < closest_km:
            closest = label
            closest_km = distance
    return closest


def _box(south, west, north, east):
    return f"({south},{west},{north},{east})"


def too_wide(south, west, north, east):
    return north - south > 0.4 or east - west > 0.6 or north <= south or east <= west


def _language_key(accept_language):
    tag = (accept_language or "en").split(",", 1)[0].split(";", 1)[0].strip().lower()
    return tag[:16] or "en"


def _local_view(south, west, north, east, accept_language):
    from survey.backend.outdoors import available, covers, view_places

    if not available() or not covers(south, west, north, east):
        return None
    try:
        return view_places(south, west, north, east, accept_language)
    except Exception:
        log.warning("local outdoors map failed", exc_info=True)
        return None


def _zoomed_out_payload():
    return {
        "searching_near": None,
        "zoomed_out": True,
        "places": [],
    }


def map_view(south, west, north, east, accept_language=""):
    if north <= south or east <= west:
        return _zoomed_out_payload()
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    # Ensure a minimum ~3 km window so zooming in closely on a cluster
    # never loses nearby trailheads or misses the cached region tile.
    south = min(south, center_lat - 0.03)
    north = max(north, center_lat + 0.03)
    west = min(west, center_lon - 0.04)
    east = max(east, center_lon + 0.04)
    south, west, north, east = (
        _snap(south, 0.02, False),
        _snap(west, 0.02, False),
        _snap(north, 0.02, True),
        _snap(east, 0.02, True),
    )
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    key = f"view:9:{_language_key(accept_language)}:{south:.4f}:{west:.4f}:{north:.4f}:{east:.4f}"
    cached = _recall(key)
    if cached is not None:
        return cached
    local = _local_view(south, west, north, east, accept_language)
    if local is not None:
        _remember(key, local, WEEK)
        return local
    if too_wide(south, west, north, east):
        return _zoomed_out_payload()
    area = _box(south, west, north, east)
    query = f"""
[out:json][timeout:15];
(
  node["highway"="trailhead"]{area};
  way["highway"="trailhead"]{area};
  node["amenity"="parking"]{area};
  way["amenity"="parking"]{area};
  way(around:8000,{center_lat},{center_lon})["route"~"^(hiking|foot|bicycle)$"];
  relation(around:8000,{center_lat},{center_lon})["route"~"^(hiking|foot|bicycle)$"];
  node["place"~"^(town|city)$"](around:20000,{center_lat},{center_lon});
);
out center tags;
"""
    try:
        elements = _overpass(query)
    except MapLookupFailed:
        stale = _recall(key, allow_stale=True)
        if stale is not None:
            return stale
        raise
    raw_pins = []
    trailheads = []
    parking_lots = []
    route_anchors = _route_anchors(elements)
    for element in elements:
        pin = _pin(element)
        if pin is None:
            continue
        if pin["kind"] == "trailhead":
            trailheads.append(pin)
        else:
            tags = element.get("tags") or {}
            if not _excluded_parking(tags, pin["name"]):
                parking_lots.append(pin)

    raw_pins.extend(_keep_trail_parking_lots(parking_lots, trailheads, route_anchors))

    for th in trailheads:
        near_trail = None
        if not th["named"]:
            best_km = 0.45
            for other in raw_pins:
                if other["named"]:
                    km = _kilometers(th["lat"], th["lon"], other["lat"], other["lon"])
                    if km < best_km:
                        best_km = km
                        near_trail = other["name"]
        th["near_trail"] = near_trail
        raw_pins.append(th)

    pins = []
    for pin in raw_pins:
        distance = _kilometers(center_lat, center_lon, pin["lat"], pin["lon"])
        if pin["kind"] == "trailhead":
            rank = 0
        elif pin["named"]:
            rank = 1
        elif pin.get("near_trail"):
            rank = 2
        else:
            rank = 3
        pins.append((rank, distance, pin))
    pins.sort(key=lambda item: (item[0], item[1]))
    places = []
    for _rank, _distance, pin in pins[:150]:
        places.append(pin)
    payload = {
        "searching_near": _town_name(elements, center_lat, center_lon),
        "zoomed_out": False,
        "places": places,
    }
    _remember_many([(key, payload), *_element_rows(elements)], WEEK)
    return payload


def search_nearby(text, lat, lon):
    query_text = text.strip()
    if NAME_OK.fullmatch(query_text) is None:
        return []
    key = f"search:{query_text.casefold()}:{round(lat, 1)}:{round(lon, 1)}"
    cached = _recall(key)
    if cached is not None:
        return cached
    safe = re.sub(r"([.\\+*?\[\](){}|^$])", r"\\\1", query_text)
    dlat = 30 / 111
    dlon = 30 / (111 * max(math.cos(math.radians(lat)), 0.2))
    area = _box(lat - dlat, lon - dlon, lat + dlat, lon + dlon)
    query = f"""
[out:json][timeout:8];
(
  node["highway"="trailhead"]["name"~"{safe}",i]{area};
  way["highway"="trailhead"]["name"~"{safe}",i]{area};
  node["amenity"="parking"]["name"~"{safe}",i]{area};
  way["amenity"="parking"]["name"~"{safe}",i]{area};
);
out center tags 15;
"""
    try:
        elements = _overpass(query)
    except MapLookupFailed:
        stale = _recall(key, allow_stale=True)
        if stale is not None:
            return stale
        raise
    places = []
    for element in elements:
        pin = _pin(element)
        if pin and pin["named"]:
            places.append(pin)
    _remember_many([(key, places), *_element_rows(elements)], WEEK)
    return places


def _choice_key(choice):
    return (
        choice.get("kind"),
        round(float(choice["lat"]), 3),
        round(float(choice["lon"]), 3),
        (choice.get("label") or "").casefold(),
    )


def _append_choice(choices, seen, choice):
    if not choice:
        return
    label = (choice.get("label") or "").casefold()
    kind = choice.get("kind")
    if label:
        for item in choices:
            if (item.get("label") or "").casefold() != label or item.get("kind") != kind:
                continue
            try:
                km = _kilometers(item["lat"], item["lon"], choice["lat"], choice["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if km < 2:
                return
    key = _choice_key(choice)
    if key in seen:
        return
    seen.add(key)
    choices.append(choice)


def _short_place(address):
    address = address or {}
    state = (address.get("state") or "").strip()
    country = (address.get("country") or "").strip()
    if state and country:
        return f"{state}, {country}"
    return state or country


def _region_name(lat, lon):
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode({
        "lat": f"{lat:.4f}",
        "lon": f"{lon:.4f}",
        "format": "jsonv2",
        "zoom": "5",
        "addressdetails": "1",
    })
    try:
        payload = _get(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    return _short_place(payload.get("address") or {})


def nearest_town(lat, lon):
    cell_lat = round(float(lat), 1)
    cell_lon = round(float(lon), 1)
    key = f"regionat:{cell_lat:.1f}:{cell_lon:.1f}"
    cached = _recall(key)
    if isinstance(cached, dict):
        return cached.get("name") or ""
    name = _region_name(cell_lat, cell_lon)
    _remember(key, {"name": name}, WEEK)
    return name


def _attach_where(choices):
    pending = {}
    for choice in choices:
        if choice.get("where"):
            continue
        try:
            cell = (round(float(choice["lat"]), 1), round(float(choice["lon"]), 1))
        except (KeyError, TypeError, ValueError):
            continue
        pending.setdefault(cell, []).append(choice)
    if not pending:
        return

    def _lookup(cell):
        return cell, nearest_town(cell[0], cell[1])

    with ThreadPoolExecutor(max_workers=4) as pool:
        found = list(pool.map(_lookup, list(pending)))
    for cell, name in found:
        if not name:
            continue
        for choice in pending[cell]:
            choice["where"] = name


def _by_distance(choices, lat, lon):
    def _km(choice):
        try:
            return _kilometers(lat, lon, choice["lat"], choice["lon"])
        except (KeyError, TypeError, ValueError):
            return 1e9
    return sorted(choices, key=_km)


def search_trails(text, lat, lon):
    query_text = text.strip()
    if NAME_OK.fullmatch(query_text) is None:
        return []
    key = f"trail:{query_text.casefold()}:{round(lat, 1)}:{round(lon, 1)}"
    cached = _recall(key)
    if cached is not None:
        return cached
    safe = re.sub(r"([.\\+*?\[\](){}|^$])", r"\\\1", query_text)
    dlat = 50 / 111
    dlon = 50 / (111 * max(math.cos(math.radians(lat)), 0.2))
    area = _box(lat - dlat, lon - dlon, lat + dlat, lon + dlon)
    query = f"""
[out:json][timeout:8];
(
  relation["route"="hiking"]["name"~"{safe}",i]{area};
  way["route"="hiking"]["name"~"{safe}",i]{area};
);
out center tags 12;
"""
    try:
        elements = _overpass(query)
    except MapLookupFailed:
        stale = _recall(key, allow_stale=True)
        if stale is not None:
            return stale
        raise
    trails = []
    for element in elements:
        tags = element.get("tags") or {}
        name = _label(tags)
        point = _point(element)
        if not name or point is None:
            continue
        trails.append({
            "kind": "trail",
            "label": name,
            "detail": "Hiking trail",
            "lat": point[0],
            "lon": point[1],
        })
    _remember(key, trails, WEEK)
    return trails


def find_places(text, lat, lon):
    query = text.strip()
    if len(query) < 2 or len(query) > 60:
        return []
    key = f"places:4:{query.casefold()}:{round(lat, 1)}:{round(lon, 1)}"
    cached = _recall(key)
    if cached is not None:
        return cached
    dlat = 2.0
    dlon = 2.5
    viewbox = f"{lon - dlon},{lat - dlat},{lon + dlon},{lat + dlat}"
    url = PLACE_URL + "?" + urllib.parse.urlencode({
        "q": query,
        "format": "jsonv2",
        "addressdetails": "1",
        "namedetails": "1",
        "limit": "8",
        "viewbox": viewbox,
        "bounded": "0",
    })
    try:
        payload = _get(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        log.warning("place lookup failed")
        stale = _recall(key, allow_stale=True)
        return stale if stale is not None else []
    if not payload:
        _remember(key, [], WEEK)
        return []
    skip = {"country", "continent", "state", "ocean", "sea"}
    places = []
    for hit in payload:
        addresstype = (hit.get("addresstype") or hit.get("type") or "").lower()
        if addresstype in skip:
            continue
        try:
            hit_lat = float(hit["lat"])
            hit_lon = float(hit["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        names = hit.get("namedetails") or {}
        label = (
            names.get("name:en")
            or hit.get("name")
            or (hit.get("display_name") or "").split(",")[0]
            or query
        ).strip()
        parts = [part.strip() for part in (hit.get("display_name") or "").split(",")]
        detail_parts = [part for part in parts[1:4] if part and part != label]
        detail = ", ".join(detail_parts) if detail_parts else addresstype.replace("_", " ").title()
        hit_type = (hit.get("type") or "").lower()
        if addresstype in {"peak", "mountain", "volcano"} or hit_type in {"peak", "mountain", "volcano"}:
            kind = "peak"
        elif addresstype in {"climbing", "climb"} or hit_type in {"climbing", "climb"}:
            kind = "climb"
        else:
            kind = "place"
        places.append({
            "kind": kind,
            "placeType": addresstype or hit_type or "place",
            "label": label,
            "detail": detail,
            "where": _short_place(hit.get("address") or {}),
            "lat": hit_lat,
            "lon": hit_lon,
        })
    _remember(key, places, WEEK)
    return places


def search_map(text, lat, lon, accept_language=""):
    query_text = text.strip()
    if len(query_text) < 2:
        return {"choices": []}
    key = f"mapsearch:7:{_language_key(accept_language)}:{query_text.casefold()}:{round(lat, 1)}:{round(lon, 1)}"
    cached = _recall(key)
    if cached is not None:
        return cached
    from survey.backend.outdoors import available, search_choices

    if available():
        try:
            local_hits = search_choices(query_text, lat, lon, accept_language)
        except Exception:
            log.warning("local outdoors search failed", exc_info=True)
            local_hits = None
        if local_hits:
            choices = []
            seen = set()
            for choice in local_hits:
                _append_choice(choices, seen, choice)
            for place in find_places(query_text, lat, lon):
                _append_choice(choices, seen, place)
            _attach_where(choices)
            payload = {"choices": _by_distance(choices, lat, lon)}
            _remember(key, payload, WEEK)
            return payload
    choices = []
    seen = set()

    def _pins():
        try:
            return search_nearby(query_text, lat, lon)
        except MapLookupFailed:
            return []

    def _trails():
        try:
            return search_trails(query_text, lat, lon)
        except MapLookupFailed:
            return []

    with ThreadPoolExecutor(max_workers=3) as pool:
        pin_job = pool.submit(_pins)
        trail_job = pool.submit(_trails)
        place_job = pool.submit(find_places, query_text, lat, lon)
        pin_hits = pin_job.result()
        trail_hits = trail_job.result()
        place_hits = place_job.result()

    for pin in pin_hits:
        _append_choice(choices, seen, {
            "kind": "pin",
            "label": pin["name"],
            "detail": "Trailhead" if pin["kind"] == "trailhead" else "Parking",
            "lat": pin["lat"],
            "lon": pin["lon"],
            "pin": pin,
        })
    for trail in trail_hits:
        _append_choice(choices, seen, trail)
    for place in place_hits:
        _append_choice(choices, seen, place)
    _attach_where(choices)
    payload = {"choices": _by_distance(choices, lat, lon)}
    _remember(key, payload, WEEK)
    return payload


def places_near(lat, lon, radius_km=14, accept_language=""):
    dlat = radius_km / 111
    dlon = radius_km / (111 * max(math.cos(math.radians(lat)), 0.2))
    return map_view(lat - dlat, lon - dlon, lat + dlat, lon + dlon, accept_language)


def find_town(text):
    query = text.strip()
    if len(query) < 2 or len(query) > 60:
        return None
    key = f"town:{query.casefold()}"
    cached = _recall(key)
    if cached is not None:
        return cached
    url = PLACE_URL + "?" + urllib.parse.urlencode({
        "q": query,
        "format": "jsonv2",
        "addressdetails": "1",
        "namedetails": "1",
        "limit": "5",
    })
    try:
        payload = _get(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        log.warning("town lookup failed")
        return _recall(key, allow_stale=True)
    if not payload:
        return None
    for hit in payload:
        addresstype = (hit.get("addresstype") or hit.get("type") or "").lower()
        if addresstype in {"country", "continent", "state", "ocean", "sea"}:
            continue
        try:
            lat = float(hit["lat"])
            lon = float(hit["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        names = hit.get("namedetails") or {}
        label = (
            names.get("name:en")
            or hit.get("name")
            or (hit.get("display_name") or "").split(",")[0]
            or query
        ).strip()
        moved = {"label": label, "lat": lat, "lon": lon}
        _remember(key, moved, YEAR)
        return moved
    return None


def _timezone_name(lat, lon):
    key = f"zone:{lat:.2f}:{lon:.2f}"
    cached = _recall(key)
    if cached:
        return cached
    url = f"{TIME_URL}?latitude={lat}&longitude={lon}"
    try:
        payload = _get(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        stale = _recall(key, allow_stale=True)
        if stale:
            return stale
        log.warning("timezone lookup failed")
        raise MapLookupFailed
    name = payload.get("timeZone")
    if not name:
        log.warning("timezone lookup failed")
        raise MapLookupFailed
    _remember(key, name, YEAR)
    return name


def _tags_of(osm_type, osm_id):
    if osm_type not in {"node", "way", "relation"} or not str(osm_id).isdigit():
        return None
    key = f"el:{osm_type}:{osm_id}"
    cached = _recall(key)
    if cached is not None:
        return cached
    query = f"[out:json][timeout:12];{osm_type}({osm_id});out center tags;"
    for element in _overpass(query):
        if str(element.get("id")) == str(osm_id):
            _remember(key, element, WEEK)
            return element
    return None


def _numbers(tags):
    capacity = tags.get("capacity")
    fee = tags.get("fee") if tags.get("fee") in {"yes", "no"} else None
    toilet = 1 if tags.get("toilets") == "yes" else None
    number = int(capacity) if capacity and str(capacity).isdigit() else None
    return number, fee, tags.get("surface"), tags.get("opening_hours"), toilet


def _contributed_trail(body):
    typed = (body.trail_name or "").strip()
    if not typed:
        return ""
    if len(typed) < 2 or len(typed) > 80:
        return None
    return typed


def store_place(conn, body):
    trail_name = _contributed_trail(body)
    if trail_name is None:
        return None
    if body.osm_type and body.osm_id:
        element = _tags_of(body.osm_type, body.osm_id)
        if element is None:
            return None
        pin = _pin(element)
        if pin is None:
            return None
        tags = element.get("tags") or {}
        capacity, fee, surface, hours, toilet = _numbers(tags)
        lat, lon = pin["lat"], pin["lon"]
        name = pin["name"]
        if name:
            pending = 0
        else:
            name = (body.name or "").strip()
            if len(name) < 2 or len(name) > 80:
                return None
            pending = 1
        if pin["kind"] == "trailhead" and not trail_name:
            trail_name = name
        osm_type, osm_id = pin["osm_type"], pin["osm_id"]
    else:
        name = (body.name or "").strip()
        if len(name) < 2 or len(name) > 80 or body.lat is None or body.lon is None:
            return None
        if not -90 <= body.lat <= 90 or not -180 <= body.lon <= 180:
            return None
        capacity = fee = surface = hours = toilet = None
        lat, lon = body.lat, body.lon
        pending = 1
        osm_type = osm_id = None
    trail_name = trail_name or None
    zone = _timezone_name(lat, lon)
    existing = None
    if osm_type and osm_id:
        existing = conn.execute(
            "SELECT id FROM places WHERE osm_type = ? AND osm_id = ?",
            (osm_type, osm_id),
        ).fetchone()
    if existing is not None:
        conn.execute(
            """
            UPDATE places
            SET name = ?, trail_name = ?, lat = ?, lon = ?, timezone = ?, capacity = ?,
                fee = ?, opening_hours = ?, surface = ?, toilet = ?, pending = ?
            WHERE id = ?
            """,
            (name, trail_name, lat, lon, zone, capacity, fee, hours, surface, toilet, pending, existing["id"]),
        )
        place_id = existing["id"]
    else:
        cursor = conn.execute(
            """
            INSERT INTO places (
              osm_type, osm_id, name, trail_name, lat, lon, timezone,
              capacity, fee, opening_hours, surface, toilet, pending
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (osm_type, osm_id, name, trail_name, lat, lon, zone, capacity, fee, hours, surface, toilet, pending),
        )
        place_id = cursor.lastrowid
    return conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
