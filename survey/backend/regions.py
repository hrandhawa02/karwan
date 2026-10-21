"""State and country names for places in outdoors.db.

Natural Earth 10m admin-1 polygons are matched offline. Search reads the
result from two small tables. Nothing calls a geocoder at request time.

    uv pip install shapely pyshp
    uv run python -m survey.backend.regions [outdoors.db]

The boundary shapefile stays in karwan-data/ and is not committed.
A later planet build applies the same file when it is still there.
"""

import sqlite3
import sys
import time
from pathlib import Path

from survey.backend.outdoors import COUNTRY_SHORT, DATA_DIR, DB_PATH

BOUNDARY = DATA_DIR / "ne_10m_admin_1" / "ne_10m_admin_1_states_provinces.shp"
BATCH = 100_000
CHECKS = (
    (-121.74, 47.49, "Washington", "United States"),
    (-77.036, 38.907, "District of Columbia", "United States"),
    (-115.57, 51.18, "Alberta", "Canada"),
    (-0.127, 51.507, "Westminster", "United Kingdom"),
    (0.0, 0.0, None, None),
)


def _text(value):
    text = str(value or "").strip()
    if text in {"", "-99"}:
        return ""
    return text


def _label(record):
    state = _text(record.get("name_en")) or _text(record.get("name")) or _text(record.get("gn_name"))
    # name_en on this district is the city, which collides with the state.
    if _text(record.get("iso_3166_2")) == "US-DC":
        state = "District of Columbia"
    country = _text(record.get("admin")) or _text(record.get("geonunit"))
    country = COUNTRY_SHORT.get(country, country)
    if not state and not country:
        return None
    return state, country


def _polygonal(geom):
    from shapely.geometry import MultiPolygon

    kind = geom.geom_type
    if kind in {"Polygon", "MultiPolygon"}:
        return geom
    if kind != "GeometryCollection":
        return None
    parts = []
    for part in geom.geoms:
        if part.geom_type == "Polygon":
            parts.append(part)
        elif part.geom_type == "MultiPolygon":
            parts.extend(part.geoms)
    if not parts:
        return None
    return MultiPolygon(parts)


def _rank(level):
    """Prefer a state or province over a county, and a county over a country outline."""
    try:
        level = int(level)
    except (TypeError, ValueError):
        return 3
    if level == 1:
        return 0
    if level == 2:
        return 1
    if level == 0:
        return 2
    return 3


class RegionIndex:
    def __init__(self, geoms, labels, areas, ranks, tree):
        self.geoms = geoms
        self.labels = labels
        self.areas = areas
        self.ranks = ranks
        self.tree = tree

    def locate_many(self, lons, lats):
        import numpy as np
        from shapely import points

        count = len(lons)
        found = [None] * count
        if count == 0:
            return found
        queried = points(np.asarray(lons, dtype=np.float64), np.asarray(lats, dtype=np.float64))
        hits = self.tree.query(queried, predicate="intersects")
        if hits.size == 0:
            return found
        point_idx = hits[0]
        geom_idx = hits[1]
        order = np.lexsort((self.areas[geom_idx], self.ranks[geom_idx], point_idx))
        point_idx = point_idx[order]
        geom_idx = geom_idx[order]
        _, firsts = np.unique(point_idx, return_index=True)
        for point_i, geom_i in zip(point_idx[firsts].tolist(), geom_idx[firsts].tolist()):
            found[point_i] = self.labels[geom_i]
        return found


def load_index(path):
    import numpy as np
    import shapefile
    from shapely import STRtree, make_valid
    from shapely.geometry import shape as to_geom

    print(f"Reading {path.name}", flush=True)
    reader = shapefile.Reader(str(path), encoding="utf-8")
    geoms = []
    labels = []
    areas = []
    ranks = []
    for item in reader.iterShapeRecords():
        record = item.record.as_dict()
        label = _label(record)
        if label is None:
            continue
        try:
            geom = to_geom(item.shape.__geo_interface__)
        except Exception:
            continue
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = make_valid(geom)
        geom = _polygonal(geom)
        if geom is None or geom.is_empty or geom.area <= 0:
            continue
        geoms.append(geom)
        labels.append(label)
        areas.append(geom.area)
        ranks.append(_rank(record.get("gadm_level")))
    if not geoms:
        raise RuntimeError(f"No state boundaries in {path}")
    print(f"  {len(geoms):,} boundaries", flush=True)
    return RegionIndex(
        geoms,
        labels,
        np.asarray(areas, dtype=np.float64),
        np.asarray(ranks, dtype=np.int8),
        STRtree(geoms),
    )


def _require_known(index):
    for lon, lat, state, country in CHECKS:
        found = index.locate_many([lon], [lat])[0]
        expect = None if state is None else (state, country)
        if found != expect:
            raise SystemExit(f"Boundary check failed at {lat}, {lon}: expected {expect}, got {found}")
    print("Boundary checks passed", flush=True)


def _prepare(conn, labels):
    conn.executescript(
        """
        DROP TABLE IF EXISTS place_regions;
        DROP TABLE IF EXISTS regions;
        CREATE TABLE regions (
            id INTEGER PRIMARY KEY,
            state TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '',
            UNIQUE (state, country)
        );
        CREATE TABLE place_regions (
            id INTEGER PRIMARY KEY,
            region_id INTEGER NOT NULL
        ) WITHOUT ROWID;
        """
    )
    conn.executemany(
        "INSERT INTO regions (state, country) VALUES (?, ?)",
        sorted(set(labels)),
    )
    conn.execute(
        """
        INSERT INTO meta (key, value) VALUES ('regions', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        ("natural-earth-10m-admin-1",),
    )
    conn.commit()
    return {
        (state, country): region_id
        for region_id, state, country in conn.execute("SELECT id, state, country FROM regions")
    }


def _fill(conn, index, ids):
    last = 0
    named = 0
    seen = 0
    started = time.time()
    total = conn.execute("SELECT COUNT(*) FROM places").fetchone()[0]
    while True:
        rows = conn.execute(
            "SELECT id, lat, lon FROM places WHERE id > ? ORDER BY id LIMIT ?",
            (last, BATCH),
        ).fetchall()
        if not rows:
            break
        last = rows[-1][0]
        located = index.locate_many([row[2] for row in rows], [row[1] for row in rows])
        pairs = []
        for row, label in zip(rows, located):
            region_id = ids.get(label) if label else None
            if region_id is not None:
                pairs.append((row[0], region_id))
        if pairs:
            conn.executemany(
                "INSERT INTO place_regions (id, region_id) VALUES (?, ?)",
                pairs,
            )
            named += len(pairs)
        conn.commit()
        seen += len(rows)
        elapsed = max(time.time() - started, 0.001)
        print(
            f"  {seen:,} / {total:,} places, {named:,} named ({seen / elapsed:,.0f}/s)",
            flush=True,
        )
    return named, total


def assign_regions(conn, path=None):
    """Fill regions and place_regions on an open outdoors database."""
    shp = Path(path) if path else BOUNDARY
    if not shp.is_file():
        print(f"No state boundaries at {shp}; search will not show a state", flush=True)
        return False
    try:
        index = load_index(shp)
    except ImportError:
        print(
            "Install shapely and pyshp to add state and country names "
            "(uv pip install shapely pyshp)",
            flush=True,
        )
        return False
    _require_known(index)
    print("Writing state and country onto places", flush=True)
    ids = _prepare(conn, index.labels)
    named, total = _fill(conn, index, ids)
    print(f"State and country on {named:,} of {total:,} places", flush=True)
    return True


def main():
    if len(sys.argv) > 2:
        print("usage: python -m survey.backend.regions [outdoors.db]", file=sys.stderr)
        sys.exit(2)
    db = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) == 2 else DB_PATH
    if not db.is_file():
        print(f"Missing map database: {db}", file=sys.stderr)
        sys.exit(1)
    before = db.stat().st_size
    conn = sqlite3.connect(db, timeout=120)
    try:
        conn.execute("PRAGMA busy_timeout=120000")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-400000")
        conn.execute("PRAGMA temp_store=MEMORY")
        ok = assign_regions(conn)
    finally:
        conn.close()
    if not ok:
        sys.exit(1)
    after = db.stat().st_size
    print(f"Database grew by {(after - before) / 1_000_000:.0f} MB", flush=True)


if __name__ == "__main__":
    main()
