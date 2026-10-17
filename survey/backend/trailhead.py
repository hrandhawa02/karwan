import sqlite3

SAMPLE_TYPE = "way"
SAMPLE_ID = "40032953"


def seed_sample(conn: sqlite3.Connection) -> None:
    existing = conn.execute(
        "SELECT id FROM places WHERE osm_type = ? AND osm_id = ?",
        (SAMPLE_TYPE, SAMPLE_ID),
    ).fetchone()
    if existing is not None:
        return
    conn.execute(
        """
        INSERT INTO places (
          osm_type, osm_id, name, lat, lon, timezone,
          capacity, capacity_disabled, fee, opening_hours,
          surface, toilet, pending
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, 0)
        """,
        (
            SAMPLE_TYPE,
            SAMPLE_ID,
            "Mount Si Trailhead Parking",
            47.4880579,
            -121.7237349,
            "America/Los_Angeles",
            "yes",
            "gravel",
        ),
    )


def sample_row(conn: sqlite3.Connection):
    return conn.execute(
        "SELECT * FROM places WHERE osm_type = ? AND osm_id = ?",
        (SAMPLE_TYPE, SAMPLE_ID),
    ).fetchone()


def place_facts(row: sqlite3.Row) -> list[str]:
    facts = []
    if row["fee"] == "yes":
        facts.append("Fee required")
    elif row["fee"] == "no":
        facts.append("No fee listed")
    if row["capacity"] is not None:
        facts.append(f"About {row['capacity']} spaces")
    if row["opening_hours"]:
        facts.append(row["opening_hours"])
    if row["surface"]:
        surface = row["surface"].replace("_", " ").capitalize()
        facts.append(f"{surface} surface")
    if row["toilet"]:
        facts.append("Bathrooms are listed")
    return facts


def zone_label(name: str) -> str:
    known = {
        "America/Los_Angeles": "Pacific time",
        "America/Vancouver": "Pacific time",
        "America/Denver": "Mountain time",
        "America/Boise": "Mountain time",
        "America/Phoenix": "Mountain time",
        "America/Chicago": "Central time",
        "America/New_York": "Eastern time",
        "America/Anchorage": "Alaska time",
        "Pacific/Honolulu": "Hawaii time",
    }
    if name in known:
        return known[name]
    city = name.split("/")[-1].replace("_", " ")
    return f"{city} time"


def place_public(row: sqlite3.Row) -> dict:
    toilet = row["toilet"]
    return {
        "id": row["id"],
        "name": row["name"],
        "trail_name": row["trail_name"],
        "lat": row["lat"],
        "lon": row["lon"],
        "timezone": row["timezone"],
        "zone_label": zone_label(row["timezone"]),
        "fee": row["fee"],
        "surface": row["surface"],
        "capacity": row["capacity"],
        "opening_hours": row["opening_hours"],
        "toilet": bool(toilet) if toilet is not None else None,
        "facts": place_facts(row),
        "searching_near": "North Bend",
        "sample": True,
    }
