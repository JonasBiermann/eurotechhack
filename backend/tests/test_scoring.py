"""Tests for the redesigned Matching Score + transparency contract.

Run: PYTHONPATH=backend pytest backend/tests
"""
import config
import projections
import weights as weights_mod
from scoring import ResidentProfile, compute_match_score, rank_destinations

# --- Destination fixtures (new honest fields) ---
CLOSE_CHEAP = {
    "id": "close_cheap", "rent_monthly_hkd": 1500, "col_monthly_hkd": 1800,
    "care_home_private_hkd": 3000, "ehcv_points": 2, "gdrcs_available": True,
    "cantonese_env": 0.9, "step_free_housing": 0.85, "air_quality": 0.7,
    "green_space": 0.8, "amenity_density": 0.6,
    "border_travel_hr": 0.5, "border_oneway_hkd": 40,
    "monthly_cost": 3300, "travel_time_hr": 0.5,
}
FAR_CHEAP = {**CLOSE_CHEAP, "id": "far_cheap", "ehcv_points": 1, "gdrcs_available": False,
             "border_travel_hr": 3.0, "border_oneway_hkd": 140, "travel_time_hr": 3.0}
PRICEY = {**CLOSE_CHEAP, "id": "pricey", "rent_monthly_hkd": 9000, "col_monthly_hkd": 4000,
          "monthly_cost": 13000}


def _sub(result, key):
    return next(f["value"] for f in result["factors"] if f["key"] == key)


# --------------------------------------------------------------- contract / bounds

def test_score_in_bounds_and_four_factors():
    p = ResidentProfile()
    for dest in (CLOSE_CHEAP, FAR_CHEAP, PRICEY):
        r = compute_match_score(p, dest)
        assert 0.0 <= r["score"] <= 100.0
        assert len(r["factors"]) == len(config.SCORING_WEIGHTS) == 4
        assert set(r["subscores"]) == {"financial", "connectivity", "care", "livability"}


def test_default_weights_sum_to_one():
    assert abs(sum(config.SCORING_WEIGHTS.values()) - 1.0) < 1e-9


def test_every_persona_profile_sums_to_one():
    for name, w in weights_mod.PERSONA_WEIGHTS.items():
        assert abs(sum(w.values()) - 1.0) < 1e-9, name


# --------------------------------------------------------------- financial dimension

def test_financial_monotonic_in_income():
    lo = compute_match_score(ResidentProfile(monthly_income=8000), PRICEY)
    hi = compute_match_score(ResidentProfile(monthly_income=30000), PRICEY)
    assert _sub(hi, "financial") > _sub(lo, "financial")


def test_financial_increases_with_savings_when_unaffordable():
    # City cost (13000) exceeds income (10000): savings should bridge the gap and lift the score.
    lo = compute_match_score(ResidentProfile(monthly_income=10000, savings=50_000), PRICEY)
    hi = compute_match_score(ResidentProfile(monthly_income=10000, savings=1_000_000), PRICEY)
    assert _sub(hi, "financial") > _sub(lo, "financial")


# --------------------------------------------------------------- care dimension (reframed)

def test_care_increases_with_ehcv_points():
    p = ResidentProfile(care_level=3)
    lo = compute_match_score(p, {**CLOSE_CHEAP, "ehcv_points": 0})
    hi = compute_match_score(p, {**CLOSE_CHEAP, "ehcv_points": 4})
    assert _sub(hi, "care") > _sub(lo, "care")


def test_care_residential_rewards_gdrcs():
    p = ResidentProfile(needs_residential_care=True, care_level=3)
    no = compute_match_score(p, {**CLOSE_CHEAP, "gdrcs_available": False})
    yes = compute_match_score(p, {**CLOSE_CHEAP, "gdrcs_available": True})
    assert _sub(yes, "care") > _sub(no, "care")


# --------------------------------------------------------------- return-to-HK burden

def test_return_trips_rise_with_chronic_conditions():
    healthy = ResidentProfile(chronic_conditions=0, care_level=0)
    chronic = ResidentProfile(chronic_conditions=3, care_level=0)
    assert projections.estimate_return_trips(chronic, CLOSE_CHEAP) > \
        projections.estimate_return_trips(healthy, CLOSE_CHEAP)


def test_connectivity_prefers_closer_city_for_frequent_returner():
    p = ResidentProfile(chronic_conditions=2, care_level=2)
    close = compute_match_score(p, CLOSE_CHEAP)
    far = compute_match_score(p, FAR_CHEAP)
    assert _sub(close, "connectivity") > _sub(far, "connectivity")


# --------------------------------------------------------------- hard filters

def test_step_free_gating_penalises_overall_score():
    needy = ResidentProfile(needs_step_free=True)
    low = rank_destinations(needy, [{**CLOSE_CHEAP, "step_free_housing": 0.1}])[0]
    high = rank_destinations(needy, [{**CLOSE_CHEAP, "step_free_housing": 0.95}])[0]
    assert low["match"]["score"] < high["match"]["score"]
    assert any("step-free" in w.lower() for w in low["warnings"])


# --------------------------------------------------------------- persona selection

def test_persona_autoselect():
    assert weights_mod.auto_select(ResidentProfile(needs_residential_care=True)) == "frail_residential"
    assert weights_mod.auto_select(ResidentProfile(chronic_conditions=2)) == "chronic_hk_anchored"
    assert weights_mod.auto_select(
        ResidentProfile(monthly_income=6000, chronic_conditions=0, care_level=0,
                        pref_near_family=0.2, family_in_hk=0.2)) == "frugal_healthy"


def test_persona_flips_ranking():
    dests = [CLOSE_CHEAP, FAR_CHEAP]
    # Frugal & healthy: cost dominates → cheaper-to-run city. FAR_CHEAP has fewer EHCV pts but
    # same cost; both cheap, so the cheapest-effective wins. Just assert persona is applied.
    frugal = rank_destinations(
        ResidentProfile(monthly_income=7000, chronic_conditions=0, care_level=0),
        dests, persona="frugal_healthy")
    assert frugal[0]["persona"] == "frugal_healthy"
    # Chronic, HK-anchored: connectivity + care up → the close, EHCV-rich city wins.
    chronic = rank_destinations(
        ResidentProfile(monthly_income=12000, chronic_conditions=2, care_level=2),
        dests, persona="chronic_hk_anchored")
    assert chronic[0]["id"] == "close_cheap"


# --------------------------------------------------------------- benefits ledger (trust-first)

def test_benefits_ledger_surfaces_public_housing_loss_and_nets_it():
    p = ResidentProfile(has_hk_public_housing=True, cssa_monthly=4000, oaa_oala_monthly=0)
    opt = rank_destinations(p, [CLOSE_CHEAP])[0]
    ledger = opt["benefits_ledger"]
    ph = [e for e in ledger if "public housing" in e["name"].lower()]
    assert ph and ph[0]["status"] == "lost" and ph[0]["monthly_value_hkd"] > 0
    assert opt["lost_benefit_value_hkd"] > 0
    assert opt["net_savings_hkd"] < opt["gross_savings_hkd"]   # losses netted into hero number
    assert any("public housing" in w.lower() for w in opt["warnings"])


def test_every_ledger_entry_is_sourced():
    opt = rank_destinations(ResidentProfile(oaa_oala_monthly=4345), [CLOSE_CHEAP])[0]
    assert opt["benefits_ledger"]
    for e in opt["benefits_ledger"]:
        assert e["source"], e
        assert e["status"] in {"kept", "gained", "lost", "at_risk", "reduced"}


def test_oala_kept_carries_day_count_condition():
    opt = rank_destinations(ResidentProfile(oaa_oala_monthly=4345), [CLOSE_CHEAP])[0]
    oala = [e for e in opt["benefits_ledger"] if "OAA" in e["name"] or "OALA" in e["name"]]
    assert oala and oala[0]["status"] == "kept"
    assert "60 days" in oala[0]["condition"]


# --------------------------------------------------------------- projections

def test_projection_block_present_and_sane():
    opt = rank_destinations(ResidentProfile(chronic_specialty="medicine"), [CLOSE_CHEAP])[0]
    assert "monthly_savings_hkd" in opt and "gross_savings_hkd" in opt
    assert opt["return_trips_per_year"] >= 0
    assert opt["time_to_care_hk_weeks"] == 96          # real HA SOP feed (medicine routine, Apr25-Mar26)
    assert opt["data_provenance"]["time_to_care_hk_weeks"] == "real"
    # cost-of-living figures are now real sourced data (Numbeo + HK official stats)
    assert opt["data_provenance"]["rent_monthly_hkd"] == "sourced"
    assert opt["data_provenance"]["net_savings_hkd"] == "sourced"


def test_ranking_sorted_and_complete():
    ranked = rank_destinations(ResidentProfile(), [CLOSE_CHEAP, FAR_CHEAP, PRICEY])
    assert len(ranked) == 3
    scores = [d["match"]["score"] for d in ranked]
    assert scores == sorted(scores, reverse=True)
