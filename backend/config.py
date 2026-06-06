"""Central configuration: data sources, seeded districts, scoring weights, field maps.

Run all backend scripts from the ``backend/`` directory so these flat-module
imports (``import config``) resolve.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
UPLOAD_DIR = DATA_DIR / "uploads"

DB_PATH = DATA_DIR / "silverlink.db"
BUILDINGS_GEOJSON = DATA_DIR / "buildings.geojson"
DESTINATIONS_JSON = DATA_DIR / "destinations.json"
DISTRICTS_JSON = DATA_DIR / "districts.json"
HEATMAP_FILES = {
    "age": DATA_DIR / "heatmap_age.json",
    "density": DATA_DIR / "heatmap_density.json",
    "nolift": DATA_DIR / "heatmap_nolift.json",
}
HEATMAP_METRICS = ("age", "density", "nolift")

# --- CSDI OGC WFS endpoints (verified reachable, EPSG:4326, GeoJSON output) ---
WFS_BASE = "https://portal.csdi.gov.hk/server/services/common/{dataset}/MapServer/WFSServer"
# LandsD OpenMap "Building" — polygon footprints (geometry + BaseHeight/TopHeight/Storeys).
LANDSD_BUILDING = {"dataset": "landsd_rcd_1637211194312_35158", "layer": "csdi:Building"}
# BD "Building information and age records" — point features with address + OP date (age).
BD_BUILDING = {"dataset": "bd_rcd_1631167534872_19764", "layer": "csdi:BDBIAR"}
WFS_PAGE = 1000  # features per GetFeature request (paginate via startIndex)

# --- Seeded districts (older urban HK). bbox = (min_lat, min_lng, max_lat, max_lng) ---
# WFS 2.0.0 with EPSG:4326 expects bbox axis order lat,lng (y,x).
DISTRICTS = [
    {"id": "ssp", "name_en": "Sham Shui Po", "name_tc": "深水埗",
     "bbox": (22.322, 114.152, 22.343, 114.174)},
    {"id": "kt", "name_en": "Kwun Tong", "name_tc": "觀塘",
     "bbox": (22.300, 114.218, 22.323, 114.242)},
    {"id": "wc", "name_en": "Wan Chai", "name_tc": "灣仔",
     "bbox": (22.268, 114.167, 22.286, 114.190)},
]

# --- BD BDBIAR property -> our field name (confirmed from a live sample) ---
BD_FIELDS = {
    "address_en": "ADDRESS_E", "address_tc": "ADDRESS_C",
    "district_en": "SEARCH1_E", "district_tc": "SEARCH1_C",
    "region_en": "SEARCH2_E", "region_tc": "SEARCH2_C",
    "block_id": "NSEARCH1_E",
    "op_number": "NSEARCH2_E",
    "op_date": "NSEARCH3_E",        # format: D/M/YYYY
    "type_en": "NSEARCH4_E", "type_tc": "NSEARCH4_C",
    "usage_en": "NSEARCH5_E", "usage_tc": "NSEARCH5_C",
    "lat": "LATITUDE", "lng": "LONGITUDE",
}

# --- No-lift / step-free heuristic ---
REFERENCE_YEAR = 2026
OLD_AGE_YEARS = 40       # built >= this many years ago counts as "old"
LOW_RISE_STOREYS = 7     # <= this many storeys + old => likely walk-up / no lift
METERS_PER_STOREY = 3.0

# --- Matching-score weights (sum = 1.0). The single place to retune the heuristic. ---
SCORING_WEIGHTS = {
    "affordability": 0.30,   # Finances:   budget vs destination cost of living
    "accessibility": 0.20,   # Mobility:   step-free need vs step-free housing availability
    "care_access": 0.25,     # Care:       care level vs care capacity + healthcare
    "lifestyle_fit": 0.15,   # Lifestyle:  prefs vs livability + HK-community presence
    "proximity": 0.10,       # nearness to HK / family
}
