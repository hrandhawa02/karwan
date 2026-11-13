import json
import math
import os
import re
import sqlite3
from pathlib import Path

from survey.backend.osm import (
    PARK_AGENCY_RE,
    TRAIL_LOT_RE,
    _excluded_parking,
    _facts,
    _kilometers,
)

DATA_DIR = Path(__file__).resolve().parents[2] / "karwan-data"
DB_PATH = Path(os.environ.get("OUTDOORS_DB", DATA_DIR / "outdoors.db"))

NAME_KEYS = {
    "name",
    "alt_name",
    "old_name",
    "official_name",
    "short_name",
    "loc_name",
    "int_name",
}
KEEP_TAGS = (
    "access",
    "operator",
    "operator:type",
    "parking",
    "park_ride",
    "fee",
    "capacity",
    "opening_hours",
    "surface",
    "toilets",
)
DETAIL = {
    "parking": "Parking",
    "trailhead": "Trailhead",
    "hike": "Hike",
    "bike": "Bike",
    "ski": "Snow",
    "climb": "Climb",
    "peak": "Peak",
    "camp": "Camp",
    "shelter": "Shelter",
    "hut": "Hut",
    "picnic": "Picnic",
    "viewpoint": "Viewpoint",
    "boat": "Boat launch",
    "beach": "Beach",
    "cave": "Cave",
    "hot_spring": "Hot spring",
    "horse": "Horse",
    "foot": "Foot",
    "lift": "Ski lift",
    "ranger": "Ranger station",
    "range": "Range",
}
MAP_KINDS = ("parking", "trailhead")
ACTIVITY_KINDS = (
    "hike",
    "bike",
    "ski",
    "climb",
    "foot",
    "camp",
    "shelter",
    "peak",
    "range",
    "viewpoint",
    "beach",
    "picnic",
    "hot_spring",
    "lift",
    "ranger",
    "boat",
    "horse",
    "hut",
    "cave",
)
ACTIVITY_CAP = 40
TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)
COUNTRY_SHORT = {
    "United States of America": "United States",
    "United Republic of Tanzania": "Tanzania",
    "Czech Republic": "Czechia",
    "Republic of Serbia": "Serbia",
    "Republic of the Congo": "Congo",
    "Democratic Republic of the Congo": "DR Congo",
    "The Bahamas": "Bahamas",
}


def place_where(state, country):
    """State and country for a search line. Country alone when they match."""
    state = (state or "").strip()
    country = COUNTRY_SHORT.get((country or "").strip(), (country or "").strip())
    if state and country and state.casefold() != country.casefold():
        return f"{state}, {country}"
    return country or state


def available():
    return DB_PATH.is_file() and DB_PATH.stat().st_size > 0


def covers(south, west, north, east):
    if not available():
        return False
    with connect() as conn:
        rows = dict(conn.execute(
            "SELECT key, value FROM meta WHERE key IN ('south', 'north', 'west', 'east')"
        ))
    if len(rows) < 4:
        return True
    data_south = float(rows["south"])
    data_north = float(rows["north"])
    data_west = float(rows["west"])
    data_east = float(rows["east"])
    return not (
        north < data_south
        or south > data_north
        or east < data_west
        or west > data_east
    )


def connect():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def kind_of(tags):
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("highway") == "trailhead":
        return "trailhead"
    if tags.get("natural") == "peak":
        return "peak"
    route = tags.get("route")
    if route == "foot":
        return "foot"
    if route == "hiking":
        return "hike"
    if route in {"bicycle", "mtb"}:
        return "bike"
    if route == "ski" or tags.get("piste:type") or tags.get("sport") == "snowboarding":
        return "ski"
    if tags.get("sport") == "climbing" or tags.get("climbing") or tags.get("via_ferrata"):
        return "climb"
    if tags.get("tourism") in {"camp_site", "caravan_site"}:
        return "camp"
    if tags.get("amenity") == "shelter":
        return "shelter"
    if tags.get("tourism") in {"alpine_hut", "wilderness_hut"}:
        return "hut"
    if tags.get("tourism") == "picnic_site":
        return "picnic"
    if tags.get("tourism") == "viewpoint":
        return "viewpoint"
    if tags.get("leisure") == "slipway":
        return "boat"
    if tags.get("natural") == "beach":
        return "beach"
    if tags.get("natural") == "cave_entrance":
        return "cave"
    if tags.get("natural") == "hot_spring":
        return "hot_spring"
    if route == "horse":
        return "horse"
    if tags.get("aerialway"):
        return "lift"
    if tags.get("amenity") == "ranger_station":
        return "ranger"
    if tags.get("sport") == "shooting" or tags.get("leisure") == "shooting":
        return "range"
    return None


def name_tags_from(tags):
    found = {}
    for key, value in tags.items():
        if not value:
            continue
        if key in NAME_KEYS or key.startswith("name:"):
            found[key] = value.strip()
    return found


def needs_name(kind):
    return kind not in {"parking", "trailhead"}


def pick_name(name_tags, accept_language=""):
    if not name_tags:
        return ""
    wanted = []
    for part in (accept_language or "").split(","):
        tag = part.split(";", 1)[0].strip().lower().replace("_", "-")
        if not tag or tag == "*":
            continue
        wanted.append(tag)
        if "-" in tag:
            wanted.append(tag.split("-", 1)[0])
    for lang in wanted:
        value = name_tags.get(f"name:{lang}")
        if value:
            return value
    for key in ("name:en", "name", "official_name", "alt_name", "int_name"):
        if name_tags.get(key):
            return name_tags[key]
    return next(iter(name_tags.values()), "")


def search_text(name_tags):
    seen = []
    for value in name_tags.values():
        if value and value not in seen:
            seen.append(value)
    return " ".join(seen)


def kept_tags(tags):
    return {key: tags.get(key) for key in KEEP_TAGS if tags.get(key)}


def known_answers(tags):
    """Complete form answers already stored on the lot.

    fee=no and toilets=no can be filled in. fee=yes does not say how
    someone paid. toilets=yes does not say the condition. access=yes
    means the public may use the lot, not that a marked accessible
    space was there.
    """
    known = {}
    if tags.get("fee") == "no":
        known["payRequired"] = "no"
    if tags.get("toilets") == "no":
        known["bathroomExists"] = "no"
    return known


def _pin_from_row(row, accept_language):
    name_tags = json.loads(row["name_tags"] or "{}")
    tags = json.loads(row["tags"] or "{}")
    name = pick_name(name_tags, accept_language) or None
    kind = "trailhead" if row["kind"] == "trailhead" else "parking" if row["kind"] == "parking" else row["kind"]
    pin = {
        "osm_type": row["osm_type"],
        "osm_id": str(row["osm_id"]),
        "name": name,
        "lat": row["lat"],
        "lon": row["lon"],
        "kind": kind,
        "facts": _facts(tags),
        "named": bool(name),
        "operator": tags.get("operator") or None,
        "outdoor_kind": row["kind"],
        "_tags": tags,
        "_name_tags": name_tags,
    }
    if "region_country" in row.keys():
        where = place_where(row["region_state"], row["region_country"])
        if where:
            pin["where"] = where
    if kind == "parking":
        known = known_answers(tags)
        if known:
            pin["known"] = known
    return pin


def place_by_osm(osm_type, osm_id):
    if not available() or osm_type not in {"node", "way", "relation"}:
        return None
    try:
        osm_id = int(osm_id)
    except (TypeError, ValueError):
        return None
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM places WHERE osm_type = ? AND osm_id = ?",
            (osm_type, osm_id),
        ).fetchone()


WIDE_LAT = 0.22
WIDE_LON = 0.32
EXPLORE_MAX_SPAN = 4.2
COUNT_KINDS = ("parking", "trailhead", *ACTIVITY_KINDS)


def _wide_view(south, west, north, east):
    return (north - south) > WIDE_LAT or (east - west) > WIDE_LON


def _public_counts(raw):
    counts = {
        kind: int(raw.get(kind, 0))
        for kind in ("parking", "trailhead", *ACTIVITY_KINDS)
    }
    return {kind: count for kind, count in counts.items() if count}


def _counts_in_box(conn, south, west, north, east):
    marks = ",".join("?" for _ in COUNT_KINDS)
    rows = conn.execute(
        f"""
        SELECT p.kind, COUNT(*)
        FROM places_box AS box
        JOIN places AS p ON p.id = box.id
        WHERE p.kind IN ({marks})
          AND box.min_lat <= ? AND box.max_lat >= ?
          AND box.min_lon <= ? AND box.max_lon >= ?
        GROUP BY p.kind
        """,
        (*COUNT_KINDS, north, south, east, west),
    ).fetchall()
    return _public_counts({kind: count for kind, count in rows})


def _cluster_step(south, west, north, east):
    """Coarser steps when zoomed out → fewer, more summarized bubbles.

    Wide mode starts around span > 0.22; keep cells large enough that
    neighbors do not visually stack (old 0.06 step caused 105-on-16).
    """
    span = max(north - south, east - west)
    if span > 8:
        return 1.6
    if span > 4:
        return 0.9
    if span > 2:
        return 0.5
    if span > 1:
        return 0.32
    if span > 0.5:
        return 0.24
    return 0.2


# Parking in clusters must resemble pin-eligible lots — not every OSM stall.
# Avoid bare "park" (matches the word "parking" itself).
_CLUSTER_PARKING_NAME_SQL = """
(
  lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%trail%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%hike%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%camp%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%peak%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%mount %'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%mt %'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%falls%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%lake%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%forest%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%wilderness%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%overlook%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%viewpoint%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%recreation%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%sno-park%'
  OR lower(coalesce(p.search_text, '') || ' ' || coalesce(p.name, '')) LIKE '%trailhead%'
)
"""


def _clamp_cluster_bbox(lat, lon, south, west, north, east, half):
    """Keep drill-down boxes near the bubble so outliers don’t empty the frame."""
    half = max(float(half), 0.04)
    return (
        max(south, lat - half),
        max(west, lon - half),
        min(north, lat + half),
        min(east, lon + half),
    )


def _merge_nearby_clusters(clusters, min_sep):
    """Greedy merge: larger bubble absorbs neighbors within min_sep degrees."""
    if not clusters or min_sep <= 0:
        return clusters
    ordered = sorted(clusters, key=lambda item: item["count"], reverse=True)
    kept = []
    for cell in ordered:
        absorbed = False
        for other in kept:
            if (
                abs(cell["lat"] - other["lat"]) < min_sep
                and abs(cell["lon"] - other["lon"]) < min_sep
            ):
                other["count"] += cell["count"]
                # Keep drill bbox tight around the surviving centroid so one
                # far point does not open a huge empty fitBounds.
                other["south"] = min(other["south"], cell["south"])
                other["west"] = min(other["west"], cell["west"])
                other["north"] = max(other["north"], cell["north"])
                other["east"] = max(other["east"], cell["east"])
                other["south"], other["west"], other["north"], other["east"] = (
                    _clamp_cluster_bbox(
                        other["lat"],
                        other["lon"],
                        other["south"],
                        other["west"],
                        other["north"],
                        other["east"],
                        min_sep * 1.4,
                    )
                )
                absorbed = True
                break
        if not absorbed:
            kept.append({
                "lat": cell["lat"],
                "lon": cell["lon"],
                "count": int(cell["count"]),
                "south": cell["south"],
                "west": cell["west"],
                "north": cell["north"],
                "east": cell["east"],
            })
    kept.sort(key=lambda item: item["count"], reverse=True)
    return kept


def _clusters_in_box(conn, south, west, north, east):
    """Cluster pin-relevant places only (trailheads, activities, trail-named lots).

    Counting every OSM parking stall made bubbles like 735 that collapsed to a
    couple of trail lots when zoomed in — drill-down felt broken.

    BBox is the real min/max of points in the cell (not reconstructed from a
    broken CAST grid on negative longitudes), so click → fitBounds still covers
    the same places the number promised.
    """
    step = _cluster_step(south, west, north, east)
    marks = ",".join("?" for _ in COUNT_KINDS)
    # floor(x/step + eps) so negative lons bin correctly (CAST truncates toward 0).
    rows = conn.execute(
        f"""
        SELECT p.kind, COUNT(*) AS n,
               AVG(p.lat) AS alat, AVG(p.lon) AS alon,
               MIN(p.lat) AS min_lat, MAX(p.lat) AS max_lat,
               MIN(p.lon) AS min_lon, MAX(p.lon) AS max_lon,
               CAST(floor(p.lat / ? + 1e-9) AS INT) AS gy,
               CAST(floor(p.lon / ? + 1e-9) AS INT) AS gx
        FROM places_box AS box
        JOIN places AS p ON p.id = box.id
        WHERE p.kind IN ({marks})
          AND box.min_lat <= ? AND box.max_lat >= ?
          AND box.min_lon <= ? AND box.max_lon >= ?
          AND (
            p.kind != 'parking'
            OR {_CLUSTER_PARKING_NAME_SQL}
          )
        GROUP BY gy, gx, p.kind
        """,
        (step, step, *COUNT_KINDS, north, south, east, west),
    ).fetchall()
    cells = {}
    raw = {}
    for kind, count, alat, alon, min_lat, max_lat, min_lon, max_lon, gy, gx in rows:
        cell = cells.setdefault(
            (gy, gx),
            {
                "n": 0,
                "wlat": 0.0,
                "wlon": 0.0,
                "south": min_lat,
                "north": max_lat,
                "west": min_lon,
                "east": max_lon,
            },
        )
        cell["n"] += count
        cell["wlat"] += alat * count
        cell["wlon"] += alon * count
        cell["south"] = min(cell["south"], min_lat)
        cell["north"] = max(cell["north"], max_lat)
        cell["west"] = min(cell["west"], min_lon)
        cell["east"] = max(cell["east"], max_lon)
        raw[kind] = raw.get(kind, 0) + count
    clusters = []
    pad = max(step * 0.05, 0.01)
    half = step * 0.9
    for cell in cells.values():
        total = cell["n"]
        if total <= 0:
            continue
        lat = cell["wlat"] / total
        lon = cell["wlon"] / total
        south, west, north, east = _clamp_cluster_bbox(
            lat,
            lon,
            cell["south"] - pad,
            cell["west"] - pad,
            cell["north"] + pad,
            cell["east"] + pad,
            half,
        )
        clusters.append({
            "lat": lat,
            "lon": lon,
            "count": int(total),
            "south": south,
            "west": west,
            "north": north,
            "east": east,
        })
    # Merge anything still closer than ~¾ of a cell (stops 105-on-16 overlaps).
    clusters = _merge_nearby_clusters(clusters, step * 0.75)
    return clusters[:48], _public_counts(raw)


def _rows_in_box(conn, south, west, north, east, kinds):
    marks = ",".join("?" for _ in kinds)
    return conn.execute(
        f"""
        SELECT p.*
        FROM places_box AS box
        JOIN places AS p ON p.id = box.id
        WHERE p.kind IN ({marks})
          AND box.min_lat <= ? AND box.max_lat >= ?
          AND box.min_lon <= ? AND box.max_lon >= ?
        """,
        (*kinds, north, south, east, west),
    ).fetchall()


def view_places(south, west, north, east, accept_language="", force_pins=False):
    if not available():
        return None
    # Search “near” must return lots/trailheads even when the box is wide.
    if _wide_view(south, west, north, east) and not force_pins:
        with connect() as conn:
            clusters, counts = _clusters_in_box(conn, south, west, north, east)
        return {
            "searching_near": None,
            "zoomed_out": True,
            "places": [],
            "clusters": clusters,
            "counts": counts,
        }
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    pad_lat = 0.45 / 111
    pad_lon = 0.45 / (111 * max(math.cos(math.radians(center_lat)), 0.2))
    with connect() as conn:
        rows = _rows_in_box(
            conn,
            south - pad_lat,
            west - pad_lon,
            north + pad_lat,
            east + pad_lon,
            MAP_KINDS,
        )
        activity_anchor_rows = _rows_in_box(
            conn,
            south - pad_lat,
            west - pad_lon,
            north + pad_lat,
            east + pad_lon,
            ACTIVITY_KINDS,
        )
        activity_rows = _rows_in_box(
            conn,
            south,
            west,
            north,
            east,
            ACTIVITY_KINDS,
        )
        counts = _counts_in_box(conn, south, west, north, east)
    pins = [_pin_from_row(row, accept_language) for row in rows]
    trailheads = [pin for pin in pins if pin["kind"] == "trailhead"]
    route_anchors = []
    for row in activity_anchor_rows:
        anchor = _pin_from_row(row, accept_language)
        if anchor["named"]:
            route_anchors.append(anchor)
    kept = []
    for pin in pins:
        if pin["kind"] != "parking":
            continue
        if _excluded_parking(pin["_tags"], pin["name"]):
            continue
        near_trail = None
        near_any = False
        near_km = 0.45
        for trailhead in trailheads:
            km = _kilometers(pin["lat"], pin["lon"], trailhead["lat"], trailhead["lon"])
            if km <= 0.45:
                near_any = True
            if trailhead["named"] and km < near_km:
                near_km = km
                near_trail = trailhead["name"]
        for route in route_anchors:
            km = _kilometers(pin["lat"], pin["lon"], route["lat"], route["lon"])
            if km <= 0.45:
                near_any = True
            if km < near_km:
                near_km = km
                near_trail = route["name"]
        has_trail_name = bool(TRAIL_LOT_RE.search(pin["name"] or ""))
        has_park_agency = bool(PARK_AGENCY_RE.search(pin.get("operator") or ""))
        if not (near_any or has_trail_name or has_park_agency):
            continue
        if not near_trail and (has_trail_name or has_park_agency):
            best_km = 1.5
            for trailhead in trailheads:
                km = _kilometers(pin["lat"], pin["lon"], trailhead["lat"], trailhead["lon"])
                if trailhead["named"] and km < best_km:
                    best_km = km
                    near_trail = trailhead["name"]
        pin["near_trail"] = near_trail
        kept.append(pin)
    for trailhead in trailheads:
        near_trail = None
        if not trailhead["named"]:
            best_km = 0.45
            for lot in kept:
                if lot["named"]:
                    km = _kilometers(trailhead["lat"], trailhead["lon"], lot["lat"], lot["lon"])
                    if km < best_km:
                        best_km = km
                        near_trail = lot["name"]
        trailhead["near_trail"] = near_trail
        kept.append(trailhead)
    ranked = []
    for pin in kept:
        if south <= pin["lat"] <= north and west <= pin["lon"] <= east:
            distance = _kilometers(center_lat, center_lon, pin["lat"], pin["lon"])
            if pin["kind"] == "trailhead":
                rank = 0
            elif pin["named"]:
                rank = 1
            elif pin.get("near_trail"):
                rank = 2
            else:
                rank = 3
            ranked.append((rank, distance, pin))
    ranked.sort(key=lambda item: (item[0], item[1]))
    places = []
    for _rank, _distance, pin in ranked[:150]:
        pin.pop("_tags", None)
        pin.pop("_name_tags", None)
        pin.pop("outdoor_kind", None)
        places.append(pin)
    by_kind = {kind: [] for kind in ACTIVITY_KINDS}
    for row in activity_rows:
        pin = _pin_from_row(row, accept_language)
        if not (south <= pin["lat"] <= north and west <= pin["lon"] <= east):
            continue
        by_kind[pin["kind"]].append((
            _kilometers(center_lat, center_lon, pin["lat"], pin["lon"]),
            pin,
        ))
    for kind in ACTIVITY_KINDS:
        nearest = sorted(by_kind[kind], key=lambda item: item[0])[:ACTIVITY_CAP]
        for _distance, pin in nearest:
            pin.pop("_tags", None)
            pin.pop("_name_tags", None)
            pin.pop("outdoor_kind", None)
            places.append(pin)
    # Pill counts must match pins we actually return. Raw parking in the box
    # includes grocery/school lots we filter out — that made “Lots 31” with ~5 pins.
    kept_parking = sum(
        1
        for pin in places
        if pin["kind"] == "parking"
        and south <= pin["lat"] <= north
        and west <= pin["lon"] <= east
    )
    counts = dict(counts)
    if kept_parking:
        counts["parking"] = kept_parking
    else:
        counts.pop("parking", None)
    return {
        "searching_near": None,
        "zoomed_out": False,
        "places": places,
        "clusters": [],
        "counts": counts,
    }


def _compact_explore_pin(row, kind, accept_language, near_trail=None, tags=None):
    name_tags = json.loads(row["name_tags"] or "{}")
    if tags is None:
        tags = json.loads(row["tags"] or "{}")
    name = pick_name(name_tags, accept_language) or None
    pin = {
        "osm_type": row["osm_type"],
        "osm_id": str(row["osm_id"]),
        "name": name,
        "lat": row["lat"],
        "lon": row["lon"],
        "kind": kind,
        "facts": _facts(tags),
    }
    if near_trail:
        pin["near_trail"] = near_trail
    if kind == "parking":
        known = known_answers(tags)
        if known:
            pin["known"] = known
    return pin


def explore_places(south, west, north, east, accept_language=""):
    """Return exact pin-eligible places in a region for client Supercluster.

    Uses spatial hashing so a ~1.5°–3.5° region runs in ~10–90 ms with no
    per-kind caps, keeping cluster counts 100% consistent across zoom levels.
    Falls back to coarse regional clusters only at multi-state zoom (>4.2°).
    """
    if not available():
        return None
    if (north - south) > EXPLORE_MAX_SPAN or (east - west) > EXPLORE_MAX_SPAN:
        with connect() as conn:
            clusters, counts = _clusters_in_box(conn, south, west, north, east)
        return {
            "zoomed_out": True,
            "places": [],
            "clusters": clusters,
            "counts": counts,
            "box": [south, west, north, east],
        }

    center_lat = (south + north) / 2
    cos_lat = max(math.cos(math.radians(center_lat)), 0.2)
    pad_lat = 1.5 / 111
    pad_lon = 1.5 / (111 * cos_lat)
    non_parking_kinds = ("trailhead", *ACTIVITY_KINDS)

    with connect() as conn:
        non_parking_rows = _rows_in_box(
            conn,
            south - pad_lat,
            west - pad_lon,
            north + pad_lat,
            east + pad_lon,
            non_parking_kinds,
        )
        parking_rows = _rows_in_box(
            conn,
            south,
            west,
            north,
            east,
            ("parking",),
        )

    # Spatial grids (~550m for 0.45 km match; ~1.6 km for 1.5 km trailhead label).
    near_cell_lat = 0.005
    near_cell_lon = 0.005 / cos_lat
    wide_cell_lat = 0.015
    wide_cell_lon = 0.015 / cos_lat

    anchor_grid = {}
    th_wide_grid = {}
    in_box_non_parking = []

    for row in non_parking_rows:
        lat = row["lat"]
        lon = row["lon"]
        kind = row["kind"]
        name_tags = json.loads(row["name_tags"] or "{}")
        picked_name = pick_name(name_tags, accept_language) or None
        is_th = kind == "trailhead"
        if is_th or picked_name:
            gy = math.floor(lat / near_cell_lat)
            gx = math.floor(lon / near_cell_lon)
            anchor_grid.setdefault((gy, gx), []).append(
                (lat, lon, is_th, picked_name)
            )
        if is_th and picked_name:
            wgy = math.floor(lat / wide_cell_lat)
            wgx = math.floor(lon / wide_cell_lon)
            th_wide_grid.setdefault((wgy, wgx), []).append(
                (lat, lon, picked_name)
            )
        if south <= lat <= north and west <= lon <= east:
            in_box_non_parking.append((row, kind, picked_name))

    places = []
    named_lot_grid = {}

    for row in parking_rows:
        lat = row["lat"]
        lon = row["lon"]
        if not (south <= lat <= north and west <= lon <= east):
            continue
        raw_name = row["name"] or ""
        raw_tags = row["tags"] or "{}"

        near_any = False
        near_trail = None
        near_km = 0.45
        gy = math.floor(lat / near_cell_lat)
        gx = math.floor(lon / near_cell_lon)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for alat, alon, _is_th, aname in anchor_grid.get((gy + dy, gx + dx), ()):
                    km = _kilometers(lat, lon, alat, alon)
                    if km <= 0.45:
                        near_any = True
                        if aname and km < near_km:
                            near_km = km
                            near_trail = aname

        # Fast skip when unnamed, far from anchors, and no operator/name_tags.
        if (
            not near_any
            and not raw_name
            and row["name_tags"] in ("", "{}")
            and '"operator"' not in raw_tags
        ):
            continue

        name_tags = json.loads(row["name_tags"] or "{}")
        picked_name = pick_name(name_tags, accept_language) or raw_name or None
        has_trail_name = bool(picked_name and TRAIL_LOT_RE.search(picked_name))
        if not near_any and not has_trail_name and '"operator"' not in raw_tags:
            continue

        tags = json.loads(raw_tags)
        if _excluded_parking(tags, picked_name):
            continue
        has_park_agency = bool(PARK_AGENCY_RE.search(tags.get("operator") or ""))
        if not (near_any or has_trail_name or has_park_agency):
            continue

        if not near_trail and (has_trail_name or has_park_agency):
            best_km = 1.5
            wgy = math.floor(lat / wide_cell_lat)
            wgx = math.floor(lon / wide_cell_lon)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for tlat, tlon, tname in th_wide_grid.get((wgy + dy, wgx + dx), ()):
                        km = _kilometers(lat, lon, tlat, tlon)
                        if km < best_km:
                            best_km = km
                            near_trail = tname

        pin = _compact_explore_pin(
            row,
            "parking",
            accept_language,
            near_trail=near_trail,
            tags=tags,
        )
        places.append(pin)
        if pin["name"]:
            named_lot_grid.setdefault((gy, gx), []).append((lat, lon, pin["name"]))

    for row, kind, picked_name in in_box_non_parking:
        near_trail = None
        if kind == "trailhead" and not picked_name:
            lat = row["lat"]
            lon = row["lon"]
            best_km = 0.45
            gy = math.floor(lat / near_cell_lat)
            gx = math.floor(lon / near_cell_lon)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for llat, llon, lname in named_lot_grid.get((gy + dy, gx + dx), ()):
                        km = _kilometers(lat, lon, llat, llon)
                        if km < best_km:
                            best_km = km
                            near_trail = lname
        places.append(
            _compact_explore_pin(row, kind, accept_language, near_trail=near_trail)
        )

    raw_counts = {}
    for pin in places:
        k = pin["kind"]
        raw_counts[k] = raw_counts.get(k, 0) + 1

    return {
        "zoomed_out": False,
        "places": places,
        "clusters": [],
        "counts": _public_counts(raw_counts),
        "box": [south, west, north, east],
    }


def _match_query(text):
    tokens = TOKEN_RE.findall(text.casefold())
    if not tokens:
        return "", ""
    words = tokens[:8]
    exact = " AND ".join(f'"{token}"' for token in words)
    prefix = " AND ".join(f'"{token}"*' for token in words)
    return exact, prefix


def _choice(pin, accept_language):
    kind = pin["outdoor_kind"]
    label = pin["name"] or DETAIL.get(kind, "Place")
    if kind in {"parking", "trailhead"}:
        public = {
            key: value
            for key, value in pin.items()
            if not key.startswith("_") and key not in {"outdoor_kind", "where"}
        }
        public["kind"] = kind
        choice = {
            "kind": "pin",
            "label": label,
            "detail": DETAIL[kind],
            "lat": pin["lat"],
            "lon": pin["lon"],
            "pin": public,
        }
    else:
        if kind == "hike":
            choice_kind = "trail"
            place_type = None
        elif kind == "peak":
            choice_kind = "peak"
            place_type = "peak"
        else:
            choice_kind = "place"
            place_type = kind
        choice = {
            "kind": choice_kind,
            "label": label,
            "detail": DETAIL.get(kind, "Place"),
            "lat": pin["lat"],
            "lon": pin["lon"],
        }
        if place_type:
            choice["placeType"] = place_type
        if accept_language:
            choice["label"] = pick_name(pin.get("_name_tags") or {}, accept_language) or label
    where = pin.get("where")
    if where:
        choice["where"] = where
    return choice


def _regions_ready(conn):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'place_regions'"
    ).fetchone()
    return row is not None


def _match_places(conn, match, regions):
    if regions:
        sql = """
            SELECT p.*, r.state AS region_state, r.country AS region_country, hits.rank
            FROM (
                SELECT rowid, bm25(places_fts) AS rank
                FROM places_fts
                WHERE places_fts MATCH ?
                ORDER BY rank
                LIMIT 40
            ) AS hits
            JOIN places AS p ON p.id = hits.rowid
            LEFT JOIN place_regions AS pr ON pr.id = p.id
            LEFT JOIN regions AS r ON r.id = pr.region_id
            ORDER BY hits.rank
        """
    else:
        sql = """
            SELECT p.*, bm25(places_fts) AS rank
            FROM places_fts
            JOIN places AS p ON p.id = places_fts.rowid
            WHERE places_fts MATCH ?
            ORDER BY rank
            LIMIT 40
        """
    return conn.execute(sql, (match,)).fetchall()


def search_choices(text, lat, lon, accept_language=""):
    if not available():
        return None
    exact, prefix = _match_query(text)
    if not exact:
        return []
    with connect() as conn:
        try:
            regions = _regions_ready(conn)
            rows = _match_places(conn, exact, regions)
            if len(rows) < 8:
                more = _match_places(conn, prefix, regions)
                seen = {row["id"] for row in rows}
                rows.extend(row for row in more if row["id"] not in seen)
        except sqlite3.OperationalError:
            return []
    pins = [_pin_from_row(row, accept_language) for row in rows]
    pins.sort(key=lambda pin: (
        0 if pin["outdoor_kind"] == "parking" else 1 if pin["outdoor_kind"] == "trailhead" else 2,
        _kilometers(lat, lon, pin["lat"], pin["lon"]),
    ))
    picked = []
    for pin in pins:
        label = (pin["name"] or "").casefold()
        if label and any(
            (other["name"] or "").casefold() == label
            and other["outdoor_kind"] == pin["outdoor_kind"]
            and _kilometers(pin["lat"], pin["lon"], other["lat"], other["lon"]) < 0.3
            for other in picked
        ):
            continue
        picked.append(pin)
        if len(picked) == 12:
            break
    return [_choice(pin, accept_language) for pin in picked]
