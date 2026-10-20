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
)
ACTIVITY_CAP = 40
TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)


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


def _pin_from_row(row, accept_language):
    name_tags = json.loads(row["name_tags"] or "{}")
    tags = json.loads(row["tags"] or "{}")
    name = pick_name(name_tags, accept_language) or None
    return {
        "osm_type": row["osm_type"],
        "osm_id": str(row["osm_id"]),
        "name": name,
        "lat": row["lat"],
        "lon": row["lon"],
        "kind": "trailhead" if row["kind"] == "trailhead" else "parking" if row["kind"] == "parking" else row["kind"],
        "facts": _facts(tags),
        "named": bool(name),
        "operator": tags.get("operator") or None,
        "outdoor_kind": row["kind"],
        "_tags": tags,
        "_name_tags": name_tags,
    }


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


def view_places(south, west, north, east, accept_language=""):
    if not available():
        return None
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
    return {
        "searching_near": None,
        "zoomed_out": False,
        "places": places,
    }


def _match_query(text):
    tokens = TOKEN_RE.findall(text.casefold())
    if not tokens:
        return ""
    return " AND ".join(f'"{token}"*' for token in tokens[:8])


def _choice(pin, accept_language):
    kind = pin["outdoor_kind"]
    label = pin["name"] or DETAIL.get(kind, "Place")
    if kind in {"parking", "trailhead"}:
        public = {key: value for key, value in pin.items() if not key.startswith("_") and key != "outdoor_kind"}
        public["kind"] = kind
        return {
            "kind": "pin",
            "label": label,
            "detail": DETAIL[kind],
            "lat": pin["lat"],
            "lon": pin["lon"],
            "pin": public,
        }
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
    return choice


def search_choices(text, lat, lon, accept_language=""):
    if not available():
        return None
    match = _match_query(text)
    if not match:
        return []
    with connect() as conn:
        try:
            rows = conn.execute(
                """
                SELECT p.*
                FROM places_fts
                JOIN places AS p ON p.id = places_fts.rowid
                WHERE places_fts MATCH ?
                LIMIT 80
                """,
                (match,),
            ).fetchall()
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
