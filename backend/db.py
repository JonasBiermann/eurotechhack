"""SQLite schema + helpers.

Tables:
  bd_records  - BD building points (address + age) with the joined LandsD height/no-lift.
  applications- resident relocation applications (the opt-in loop).
  documents   - uploaded document metadata (files stored under data/uploads/).
"""
import sqlite3
import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS bd_records (
  id           INTEGER PRIMARY KEY,
  address_en   TEXT, address_tc TEXT,
  district_id  TEXT, district_en TEXT, district_tc TEXT,
  region_en    TEXT, region_tc  TEXT,
  block_id     TEXT, op_number  TEXT, op_date TEXT,
  op_year      INTEGER, age_years INTEGER,
  type_en      TEXT, type_tc    TEXT,
  usage_en     TEXT, usage_tc   TEXT,
  lat          REAL, lng        REAL,
  footprint_id INTEGER, height_m REAL, storeys_est INTEGER,
  no_lift      INTEGER, lift_likely INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bd_district ON bd_records(district_id);

CREATE TABLE IF NOT EXISTS applications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT,
  status           TEXT,                -- submitted | under_review | approved | rejected
  applicant_name   TEXT,
  origin_address   TEXT,
  profile_json     TEXT,
  destinations_json TEXT,               -- ranked GBA choices with scores
  note             TEXT,                -- official's decision note
  decided_at       TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,
  filename       TEXT,
  stored_path    TEXT,
  size           INTEGER,
  content_type   TEXT,
  uploaded_at    TEXT,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def reset_bd_records(conn: sqlite3.Connection) -> None:
    conn.execute("DROP TABLE IF EXISTS bd_records")
    conn.executescript(SCHEMA)
