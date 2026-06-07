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
NEW_TOWNS_JSON = DATA_DIR / "new_towns.json"
DISTRICTS_JSON = DATA_DIR / "districts.json"
VOUCHER_HOSPITALS_JSON = DATA_DIR / "voucher_hospitals.json"   # 21 EHCV GBA service points (hardcoded, gov-sourced)
SOP_WAITS_JSON = DATA_DIR / "hk_sop_waits.json"               # cached HA Specialist-Outpatient waits (real snapshot)
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

# --- Matching-score weights (sum = 1.0). Default "balanced" profile; per-persona
#     overrides live in weights.py. Reframed onto 4 honest dimensions. ---
SCORING_WEIGHTS = {
    "financial":    0.35,   # Income + savings vs real cost of living (the headline)
    "connectivity": 0.25,   # Return-to-HK burden: return frequency × per-city transport cost+time
    "care":         0.25,   # Care SPEED + affordability + EHCV-eligibility (NOT "better quality")
    "livability":   0.15,   # Cantonese fit, mobility, environment, amenities
}

# --- Honest reframing constants -------------------------------------------------
# HK has world-class care QUALITY (longest life expectancy); the pain is public-system
# WAITING TIMES + COST. GBA's honest edge is fast + cheap routine care, with the HK
# public-hospital safety net kept for serious care. See plan + value-prop memory.

# HK baseline monthly costs for a relocating elderly person.
# Like-for-like with the GBA city figures: same source (Numbeo, Jun 2026), so the
# rent/col delta is an apples-to-apples comparison. Public-housing tenants pay below
# this market rate — that gap is captured honestly as the forfeited PRH subsidy below.
COST_SOURCE = "Numbeo cost-of-living + HK official statistics"
COST_AS_OF = "2026-06"
CNY_HKD = 1.157                  # CNY→HKD, Jun 2026 (mid-market)
HK_BASELINE_RENT = 13370         # 1-bedroom outside centre, HK$/mo (Numbeo HK, Jun 2026)
HK_BASELINE_COL = 8489           # single-person costs excl. rent, HK$/mo (Numbeo HK, Jun 2026)
HK_BASELINE_CARE_HOME = 15000    # private RCHE median, HK$/mo (Consumer Council RCHE survey)

# Return-to-HK trip drivers (per year). Healthy senior ~1-2; chronic on HA follow-up 3-4;
# frail multi-condition quarterly+. GBA EHCV/HA-pilot institution lets some follow-ups
# happen locally, halving HA-driven trips.
RETURN_BASE_TRIPS = 1.0          # banking / documents / admin baseline
RETURN_FAMILY_TRIPS = 2.0        # scaled by family_in_hk (0..1)
RETURN_PER_CHRONIC = 3.0         # HA specialist follow-ups per chronic condition / yr
RETURN_CHRONIC_CAP = 4           # count at most this many chronic conditions
RETURN_PILOT_FACTOR = 0.5        # ×0.5 chronic trips if city has an EHCV/HA-pilot institution
RETURN_CARE_TRIPS = 1.0          # per care_level point (0..3)
RETURN_TRIPS_CAP = 12.0

# Connectivity normalization (value of money + time of cross-border returns).
CONN_COST_INCOME_FRAC = 0.15     # annual return cost judged against 15% of yearly income
CONN_HOURS_BUDGET = 120.0        # annual hours one is willing to spend crossing back
CONN_W_COST = 0.6
CONN_W_HOURS = 0.4

# Care-speed model (weeks). HK side = real HA SOP wait (snapshot); GBA = modeled routine access.
GBA_ROUTINE_WAIT_WEEKS = 1.0     # same-day/next-week private or EHCV routine care (modeled)
GBA_NO_EHCV_WAIT_WEEKS = 4.0     # modeled, when no designated EHCV institution nearby
STEP_FREE_GATE = 0.5             # hard-filter threshold for mobility-limited seniors

# Benefit values for the transparency ledger (HK$/mo). Allowances + the PRH subsidy
# are sourced gov/research figures; community-services value remains a small estimate.
EHCV_ANNUAL_HKD = 2000           # Elderly Health Care Voucher / yr (real, hcv.gov.hk)
PUBLIC_HOUSING_SUBSIDY_HKD = 9187  # PRH implicit rent subsidy, HK$/mo (HA, 2019/20 — sourced)
COMMUNITY_SERVICES_HKD = 800     # modeled value of HK-only community care lost

# Per-number provenance so the UI can badge honesty (real / sourced / hardcoded / modeled).
#   real     = live HK open data (e.g. HA waiting times)
#   sourced  = published statistics, dated (Numbeo cost-of-living, HK official stats)
#   hardcoded= cited government scheme facts
#   modeled  = our own estimate where no data exists
PROVENANCE = {
    # destination cost fields — now real sourced data (Numbeo, Jun 2026)
    "rent_monthly_hkd": "sourced", "col_monthly_hkd": "sourced", "care_home_private_hkd": "sourced",
    "ehcv_institution": "hardcoded", "ehcv_points": "hardcoded", "gdrcs_available": "hardcoded",
    "cantonese_env": "modeled", "step_free_housing": "modeled", "air_quality": "modeled",
    "green_space": "modeled", "amenity_density": "modeled",
    "border_travel_hr": "hardcoded", "border_oneway_hkd": "hardcoded", "control_point": "hardcoded",
    # the cost-savings calculation — computed from sourced cost data + sourced PRH subsidy
    "gross_savings_hkd": "sourced", "lost_benefit_value_hkd": "sourced", "net_savings_hkd": "sourced",
    "monthly_savings_hkd": "sourced", "pct_income_freed": "sourced", "runway_years": "sourced",
    "time_to_care_hk_weeks": "real", "time_to_care_gba_weeks": "modeled",
    "return_trips_per_year": "modeled", "return_burden_hkd": "modeled", "projected_wellbeing": "modeled",
}
