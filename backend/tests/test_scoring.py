"""Tests for the Matching Score contract (run: PYTHONPATH=backend pytest backend/tests)."""
import config
import scoring
from scoring import ResidentProfile, compute_match_score, rank_destinations

CHEAP = {"id": "cheap", "monthly_cost": 3000, "step_free_housing": 0.8,
         "care_capacity": 0.7, "healthcare_score": 0.7, "livability": 0.8,
         "hk_community": 0.7, "travel_time_hr": 1.5}
PRICEY = {**CHEAP, "id": "pricey", "monthly_cost": 12000}


def test_score_in_bounds():
    p = ResidentProfile()
    for dest in (CHEAP, PRICEY):
        r = compute_match_score(p, dest)
        assert 0.0 <= r["score"] <= 100.0
        assert len(r["factors"]) == len(config.SCORING_WEIGHTS)


def test_weights_sum_to_one():
    assert abs(sum(config.SCORING_WEIGHTS.values()) - 1.0) < 1e-9


def test_affordability_monotonic_in_budget():
    lo = compute_match_score(ResidentProfile(monthly_budget=3000), PRICEY)
    hi = compute_match_score(ResidentProfile(monthly_budget=20000), PRICEY)
    af_lo = next(f["value"] for f in lo["factors"] if f["key"] == "affordability")
    af_hi = next(f["value"] for f in hi["factors"] if f["key"] == "affordability")
    assert af_hi > af_lo


def test_step_free_gating():
    needy = ResidentProfile(needs_step_free=True)
    low = compute_match_score(needy, {**CHEAP, "step_free_housing": 0.1})
    high = compute_match_score(needy, {**CHEAP, "step_free_housing": 0.95})
    acc_low = next(f["value"] for f in low["factors"] if f["key"] == "accessibility")
    acc_high = next(f["value"] for f in high["factors"] if f["key"] == "accessibility")
    assert acc_low < 0.3 < acc_high


def test_care_access_increasing_in_capacity():
    p = ResidentProfile(care_level=3)
    lo = compute_match_score(p, {**CHEAP, "care_capacity": 0.2})
    hi = compute_match_score(p, {**CHEAP, "care_capacity": 0.95})
    c_lo = next(f["value"] for f in lo["factors"] if f["key"] == "care_access")
    c_hi = next(f["value"] for f in hi["factors"] if f["key"] == "care_access")
    assert c_hi > c_lo


def test_ranking_sorted_and_complete():
    dests = [CHEAP, PRICEY, {**CHEAP, "id": "mid", "monthly_cost": 7000}]
    ranked = rank_destinations(ResidentProfile(monthly_budget=4000), dests)
    assert len(ranked) == 3
    scores = [d["match"]["score"] for d in ranked]
    assert scores == sorted(scores, reverse=True)
    # tight budget -> cheapest should win
    assert ranked[0]["id"] == "cheap"
