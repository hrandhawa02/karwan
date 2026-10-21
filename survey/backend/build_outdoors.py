"""Build outdoors.db from an OpenStreetMap PBF. Not imported by the server."""

import json
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from survey.backend.outdoors import (
    kept_tags,
    kind_of,
    name_tags_from,
    needs_name,
    search_text,
)

FILTERS = [
    "nwr/amenity=parking",
    "nwr/highway=trailhead",
    "nwr/route=hiking",
    "nwr/route=foot",
    "nwr/route=bicycle",
    "nwr/route=mtb",
    "nwr/route=ski",
    "nwr/piste:type",
    "nwr/sport=snowboarding",
    "nwr/sport=climbing",
    "nwr/climbing",
    "nwr/via_ferrata",
    "nwr/natural=peak",
    "nwr/natural=beach",
    "nwr/natural=cave_entrance",
    "nwr/natural=hot_spring",
    "nwr/tourism=camp_site",
    "nwr/tourism=caravan_site",
    "nwr/tourism=alpine_hut",
    "nwr/tourism=wilderness_hut",
    "nwr/tourism=picnic_site",
    "nwr/tourism=viewpoint",
    "nwr/amenity=shelter",
    "nwr/leisure=slipway",
    "nwr/route=horse",
    "nwr/route=running",
    "nwr/aerialway",
    "nwr/amenity=ranger_station",
    "nwr/sport=shooting",
    "nwr/leisure=shooting",
]


def filtered_path(source):
    name = source.name
    if name.endswith(".osm.pbf"):
        name = name[: -len(".osm.pbf")]
    return source.with_name(f"{name}.outdoor.osm.pbf")


def ensure_filtered(source, dest):
    if dest.is_file() and dest.stat().st_size > 0 and dest.stat().st_mtime >= source.stat().st_mtime:
        print(f"Using existing filtered file {dest}", flush=True)
        return
    print(f"Filtering {source.name} to outdoor tags", flush=True)
    subprocess.run(
        ["osmium", "tags-filter", "--overwrite", "--progress", "-o", str(dest), str(source), *FILTERS],
        check=True,
    )


def open_writer(path):
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-400000")
    conn.executescript(
        """
        CREATE TABLE places (
            id INTEGER PRIMARY KEY,
            osm_type TEXT NOT NULL,
            osm_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            name TEXT,
            name_tags TEXT NOT NULL,
            search_text TEXT NOT NULL,
            tags TEXT NOT NULL,
            UNIQUE (osm_type, osm_id)
        );
        CREATE VIRTUAL TABLE places_fts USING fts5(
            search_text,
            content='',
            tokenize='unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE places_box USING rtree(
            id, min_lat, max_lat, min_lon, max_lon
        );
        CREATE TABLE meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    return conn


class Collector:
    def __init__(self, conn):
        import osmium

        self.osmium = osmium
        self.conn = conn
        self.rows = []
        self.way_centers = {}
        self.kept = 0
        self.seen = 0
        self.started = time.time()
        index_path = Path(conn.execute("PRAGMA database_list").fetchone()[2]).with_suffix(".nodeidx")
        if index_path.exists():
            index_path.unlink()
        self.index_path = index_path
        self.index = osmium.index.create_map(f"sparse_file_array,{index_path}")

    def node(self, node):
        if not node.location.valid():
            return
        self._keep("node", node.id, node.tags, node.location.lat, node.location.lon)

    def way(self, way):
        total_lat = 0.0
        total_lon = 0.0
        count = 0
        for node in way.nodes:
            if node.location.valid():
                total_lat += node.lat
                total_lon += node.lon
                count += 1
        if not count:
            return
        lat = total_lat / count
        lon = total_lon / count
        self.way_centers[way.id] = (lat, lon)
        self._keep("way", way.id, way.tags, lat, lon)

    def relation(self, relation):
        total_lat = 0.0
        total_lon = 0.0
        count = 0
        for member in relation.members:
            if member.type == "n":
                try:
                    loc = self.index.get(member.ref)
                except (KeyError, RuntimeError, self.osmium.InvalidLocationError):
                    continue
                if loc.valid():
                    total_lat += loc.lat
                    total_lon += loc.lon
                    count += 1
            elif member.type == "w":
                center = self.way_centers.get(member.ref)
                if center:
                    total_lat += center[0]
                    total_lon += center[1]
                    count += 1
        if not count:
            return
        self._keep("relation", relation.id, relation.tags, total_lat / count, total_lon / count)

    def _keep(self, osm_type, osm_id, tags, lat, lon):
        self.seen += 1
        if self.seen % 500000 == 0:
            elapsed = max(time.time() - self.started, 1)
            print(f"Read {self.seen:,} objects, kept {self.kept:,} ({self.seen / elapsed:,.0f}/s)", flush=True)
        values = {item.k: item.v for item in tags}
        kind = kind_of(values)
        if not kind:
            return
        names = name_tags_from(values)
        if needs_name(kind) and not names:
            return
        text = search_text(names)
        self.rows.append((
            osm_type,
            int(osm_id),
            kind,
            lat,
            lon,
            names.get("name") or (next(iter(names.values())) if names else None),
            json.dumps(names, ensure_ascii=False, separators=(",", ":")),
            text,
            json.dumps(kept_tags(values), ensure_ascii=False, separators=(",", ":")),
        ))
        self.kept += 1
        if len(self.rows) >= 20000:
            self.flush()

    def flush(self):
        if not self.rows:
            return
        self.conn.executemany(
            """
            INSERT OR IGNORE INTO places
                (osm_type, osm_id, kind, lat, lon, name, name_tags, search_text, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            self.rows,
        )
        self.conn.commit()
        self.rows.clear()

    def finish(self, source_name):
        self.flush()
        print("Indexing search and map boxes", flush=True)
        self.conn.execute(
            """
            INSERT INTO places_box (id, min_lat, max_lat, min_lon, max_lon)
            SELECT id, lat, lat, lon, lon FROM places
            """
        )
        self.conn.execute(
            """
            INSERT INTO places_fts (rowid, search_text)
            SELECT id, search_text FROM places WHERE search_text != ''
            """
        )
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES ('source', ?), ('built_at', ?)",
            (source_name, datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        self.conn.execute(
            """
            INSERT INTO meta (key, value)
            SELECT 'south', MIN(lat) FROM places
            UNION ALL SELECT 'north', MAX(lat) FROM places
            UNION ALL SELECT 'west', MIN(lon) FROM places
            UNION ALL SELECT 'east', MAX(lon) FROM places
            """
        )
        self.conn.commit()
        counts = self.conn.execute(
            "SELECT kind, COUNT(*) FROM places GROUP BY kind ORDER BY COUNT(*) DESC"
        ).fetchall()
        for kind, count in counts:
            print(f"  {kind}: {count:,}", flush=True)
        total = self.conn.execute("SELECT COUNT(*) FROM places").fetchone()[0]
        print(f"Wrote {total:,} places", flush=True)
        from survey.backend.regions import assign_regions

        assign_regions(self.conn)
        self.conn.close()
        if self.index_path.exists():
            self.index_path.unlink()


def build(source, dest):
    import osmium

    filtered = filtered_path(source)
    ensure_filtered(source, filtered)
    print(f"Reading {filtered.name}", flush=True)
    conn = open_writer(dest)
    collector = Collector(conn)

    class Handler(osmium.SimpleHandler):
        def node(self, node):
            collector.node(node)

        def way(self, way):
            collector.way(way)

        def relation(self, relation):
            collector.relation(relation)

    handler = Handler()
    locations = osmium.NodeLocationsForWays(collector.index)
    locations.ignore_errors()
    entities = osmium.osm.osm_entity_bits.NODE | osmium.osm.osm_entity_bits.WAY | osmium.osm.osm_entity_bits.RELATION
    with osmium.io.Reader(str(filtered), entities, thread_pool=osmium.io.ThreadPool()) as reader:
        osmium.apply(reader, locations, handler)
    collector.finish(source.name)


def main():
    if len(sys.argv) != 3:
        print("usage: python -m survey.backend.build_outdoors SOURCE.osm.pbf DEST.db", file=sys.stderr)
        sys.exit(2)
    source = Path(sys.argv[1]).expanduser().resolve()
    dest = Path(sys.argv[2]).expanduser().resolve()
    if not source.is_file():
        print(f"Missing map file: {source}", file=sys.stderr)
        sys.exit(1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    staging = dest.with_suffix(dest.suffix + ".building")
    build(source, staging)
    staging.replace(dest)
    print(f"Ready {dest}", flush=True)


if __name__ == "__main__":
    main()
