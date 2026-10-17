import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from survey.backend.trailhead import seed_sample

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("KARWAN_DB", ROOT / "karwan.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY,
  osm_type TEXT,
  osm_id TEXT,
  name TEXT NOT NULL,
  trail_name TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  timezone TEXT NOT NULL,
  capacity INTEGER,
  capacity_disabled INTEGER,
  fee TEXT,
  opening_hours TEXT,
  surface TEXT,
  toilet INTEGER,
  pending INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  place_id INTEGER NOT NULL REFERENCES places(id),
  arrived_at TEXT NOT NULL,
  ended_at TEXT,
  timezone TEXT NOT NULL,
  cars_where TEXT,
  accessible TEXT,
  pay_required TEXT,
  pay_machine TEXT,
  parking_lot TEXT,
  could_park TEXT,
  cars TEXT,
  vehicles TEXT,
  people TEXT,
  time_there TEXT,
  overnight TEXT,
  drive_out_date TEXT,
  pass_required TEXT,
  payment TEXT,
  bathroom_exists TEXT,
  bathroom_condition TEXT,
  capacity INTEGER,
  fee TEXT,
  opening_hours TEXT,
  surface TEXT,
  toilet INTEGER,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS places_osm_unique
  ON places(osm_type, osm_id);

CREATE TABLE IF NOT EXISTS osm_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at REAL NOT NULL
);
"""


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    ensure_trail_name(conn)
    seed_sample(conn)
    widen_visits(conn)
    ensure_accessible(conn)


VISIT_COLUMNS = (
    "id",
    "place_id",
    "arrived_at",
    "ended_at",
    "timezone",
    "cars_where",
    "accessible",
    "pay_required",
    "pay_machine",
    "parking_lot",
    "could_park",
    "cars",
    "vehicles",
    "people",
    "time_there",
    "overnight",
    "drive_out_date",
    "pass_required",
    "payment",
    "bathroom_exists",
    "bathroom_condition",
    "capacity",
    "fee",
    "opening_hours",
    "surface",
    "toilet",
    "created_at",
)

VISITS_TABLE = """
CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  place_id INTEGER NOT NULL REFERENCES places(id),
  arrived_at TEXT NOT NULL,
  ended_at TEXT,
  timezone TEXT NOT NULL,
  cars_where TEXT,
  accessible TEXT,
  pay_required TEXT,
  pay_machine TEXT,
  parking_lot TEXT,
  could_park TEXT,
  cars TEXT,
  vehicles TEXT,
  people TEXT,
  time_there TEXT,
  overnight TEXT,
  drive_out_date TEXT,
  pass_required TEXT,
  payment TEXT,
  bathroom_exists TEXT,
  bathroom_condition TEXT,
  capacity INTEGER,
  fee TEXT,
  opening_hours TEXT,
  surface TEXT,
  toilet INTEGER,
  created_at TEXT NOT NULL
)
"""


def ensure_accessible(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(visits)")}
    if "accessible" not in columns:
        conn.execute("ALTER TABLE visits ADD COLUMN accessible TEXT")


def ensure_trail_name(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(places)")}
    if "trail_name" not in columns:
        conn.execute("ALTER TABLE places ADD COLUMN trail_name TEXT")


def widen_visits(conn: sqlite3.Connection) -> None:
    info = list(conn.execute("PRAGMA table_info(visits)"))
    by_name = {row[1]: row for row in info}
    if "ended_at" in by_name and not by_name.get("vehicles", (0, 0, 0, 0))[3]:
        return
    old_names = {row[1] for row in info}
    shared = [name for name in VISIT_COLUMNS if name in old_names]
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("ALTER TABLE visits RENAME TO visits_old")
    conn.execute(VISITS_TABLE)
    columns = ", ".join(shared)
    conn.execute(
        f"INSERT INTO visits ({columns}) SELECT {columns} FROM visits_old"
    )
    conn.execute("DROP TABLE visits_old")
    conn.execute("PRAGMA foreign_keys = ON")


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        init_db(conn)
        conn.execute("PRAGMA foreign_keys = ON")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
