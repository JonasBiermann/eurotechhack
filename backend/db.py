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
  status           TEXT,                -- started | submitted | under_review | approved | rejected
  applicant_name   TEXT,
  origin_address   TEXT,
  profile_json     TEXT,
  destinations_json TEXT,               -- ranked GBA choices with scores
  note             TEXT,                -- official's decision note
  decided_at       TEXT,
  declaration_at   TEXT                 -- when the resident declared truth & submitted
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

CREATE TABLE IF NOT EXISTS case_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,
  created_at     TEXT,
  author         TEXT,             -- e.g. "Officer Lam", "System", "Resident"
  kind           TEXT,             -- note | status | contact | visit | document | system | followup
  title_en       TEXT,
  title_tc       TEXT,
  body           TEXT,             -- free-form, bilingual fallback / officer-typed
  meta_json      TEXT,             -- {"from":"submitted","to":"under_review"} etc.
  FOREIGN KEY (application_id) REFERENCES applications(id)
);
CREATE INDEX IF NOT EXISTS idx_evt_app ON case_events(application_id, created_at);

CREATE TABLE IF NOT EXISTS residents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hkid            TEXT UNIQUE,     -- normalized upper-case, e.g. A123456(7)
  name            TEXT,
  created_at      TEXT,
  ehealth_consent INTEGER          -- 1 = consented to the E-Health System at registration
);

CREATE TABLE IF NOT EXISTS permit_applications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id  INTEGER,
  kind         TEXT,               -- 'home_return_permit' | 'guangdong_allowance'
  scheme       TEXT,               -- 'oaa' | 'oala' (allowance only; NULL for permit)
  status       TEXT,               -- 'submitted'
  details_json TEXT,
  created_at   TEXT,
  FOREIGN KEY (resident_id) REFERENCES residents(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,  -- opaque, secrets.token_hex(24)
  resident_id INTEGER,
  created_at  TEXT,
  FOREIGN KEY (resident_id) REFERENCES residents(id)
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
    # Defensive migrations: existing DBs already have these tables (so the CREATE
    # statements above are no-ops for them) and need the newer columns added.
    for stmt in (
        "ALTER TABLE applications ADD COLUMN resident_id INTEGER",
        "ALTER TABLE applications ADD COLUMN declaration_at TEXT",
        "ALTER TABLE residents ADD COLUMN ehealth_consent INTEGER",
    ):
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass  # column already exists
    conn.commit()
    conn.close()


def reset_bd_records(conn: sqlite3.Connection) -> None:
    conn.execute("DROP TABLE IF EXISTS bd_records")
    conn.executescript(SCHEMA)
