"""Economics + the demo headline projections.

This module holds the shared cost/return-trip helpers (imported by scoring.py) and
the four honest projections shown to the resident:

  1. Net savings + runway  (HERO)  — income/savings driven, lost benefits netted out.
  2. Time-to-care                   — real HK SOP wait → modeled GBA routine access.
  3. Return-to-HK burden            — trips/yr × per-city transport cost + hours.
  4. Projected wellbeing            — composite OUTPUT of sub-scores, labeled a projection.

Every number is tagged in config.PROVENANCE (real / hardcoded / modeled).
"""
import json

import config

# --------------------------------------------------------------- economics helpers


def portable_income(profile) -> float:
    """Monthly income that keeps flowing after relocation.

    HK retirement income is largely portable (OAA/OALA via the Guangdong/Fujian
    Scheme, portable CSSA, MPF, savings draw-down), so for the demo we treat stated
    income as portable. The *cost* of any forfeited benefit (e.g. public housing) is
    handled separately in the benefits ledger and netted into the hero number.
    """
    return float(getattr(profile, "monthly_income", 0) or 0)


def city_cost(profile, dest: dict) -> float:
    """Modeled total monthly cost of living in the destination city (HK$)."""
    rent = float(dest.get("rent_monthly_hkd", dest.get("monthly_cost", 5000)) or 0)
    col = float(dest.get("col_monthly_hkd", 0) or 0)
    cost = rent + col
    if bool(getattr(profile, "needs_residential_care", False)):
        # GDRCS-subsidised homes provide ~free core services; otherwise private fees apply.
        cost += 0.0 if dest.get("gdrcs_available") else float(dest.get("care_home_private_hkd", 4000) or 0)
    return cost


def hk_baseline_cost(profile) -> float:
    """Current HK monthly cost of living for this person, for savings deltas.

    Uses the sourced HK market reference (Numbeo), but **capped at the person's
    monthly income**: a retiree cannot spend more than they receive (subsidised
    housing + allowances are what make a low income liveable in HK). Without this
    cap, a market baseline of ~HK$21k would imply a HK$4.5k-income senior "frees up"
    more than they earn — see pct_income_freed. The cap keeps every saving figure
    bounded by reality.
    """
    market = config.HK_BASELINE_RENT + config.HK_BASELINE_COL
    if bool(getattr(profile, "needs_residential_care", False)):
        market += config.HK_BASELINE_CARE_HOME
    income = float(getattr(profile, "monthly_income", 0) or 0)
    # A pensioner lives within their means; their real outgoings ≈ income (capped at
    # the market reference for higher earners who bank the surplus).
    return float(min(market, income)) if income > 0 else float(market)


def estimate_return_trips(profile, dest: dict) -> float:
    """Modeled return trips to HK per year for this senior at this city.

    Driven by health profile (the real reason seniors must cross back): chronic HA
    follow-ups + care level + family ties. A designated EHCV/HA-pilot institution in
    the city lets some follow-ups happen locally, halving HA-driven trips.
    """
    fam = float(getattr(profile, "family_in_hk", 0.6) or 0)
    chronic = min(int(getattr(profile, "chronic_conditions", 0) or 0), config.RETURN_CHRONIC_CAP)
    care_level = int(getattr(profile, "care_level", 1) or 0)
    pilot = config.RETURN_PILOT_FACTOR if int(dest.get("ehcv_points", 0) or 0) > 0 else 1.0
    trips = (
        config.RETURN_BASE_TRIPS
        + config.RETURN_FAMILY_TRIPS * fam
        + chronic * config.RETURN_PER_CHRONIC * pilot
        + care_level * config.RETURN_CARE_TRIPS
    )
    return min(trips, config.RETURN_TRIPS_CAP)


# --------------------------------------------------------------- HK SOP wait (real)

_SOP = None


def _sop() -> dict:
    global _SOP
    if _SOP is None:
        try:
            _SOP = json.loads(config.SOP_WAITS_JSON.read_text(encoding="utf-8"))
        except Exception:
            _SOP = {"specialties": {"default": {"routine_weeks": 90, "urgent_weeks": 2}}}
    return _SOP


def hk_sop_routine_weeks(specialty: str | None) -> float:
    """Real HA Specialist-Outpatient *routine/stable* wait, in weeks, for a specialty."""
    spec = _sop().get("specialties", {})
    rec = spec.get((specialty or "").lower()) or spec.get("default") or {"routine_weeks": 90}
    return float(rec.get("routine_weeks", 90))


# --------------------------------------------------------------- the projections


def compute(profile, dest: dict, lost_benefit_value: float, subscores: dict) -> dict:
    """Return the per-option projection block (flat keys, additive to the API)."""
    income = portable_income(profile)
    c_cost = city_cost(profile, dest)
    hk_cost = hk_baseline_cost(profile)

    # 1) Net savings + runway (HERO) -------------------------------------------------
    # hk_cost is income-capped, so gross ≤ income and the percentage is bounded to a
    # sensible 0–100% (negatives mean "needs savings to live there" — see runway).
    gross_savings = hk_cost - c_cost
    net_savings = gross_savings - float(lost_benefit_value or 0)
    pct_income_freed = round(max(0.0, min(net_savings / max(income, 1.0), 1.0)), 3)

    surplus = income - c_cost  # can they live there month-to-month on income alone?
    if surplus >= 0:
        runway_years = None          # savings preserved (or growing)
        sustainable = True
    else:
        months = profile.savings / max(-surplus, 1.0)
        runway_years = round(months / 12.0, 1)
        sustainable = False

    # 2) Time-to-care: real HK wait → modeled GBA routine access ----------------------
    hk_weeks = hk_sop_routine_weeks(getattr(profile, "chronic_specialty", "medicine"))
    has_ehcv = int(dest.get("ehcv_points", 0) or 0) > 0
    gba_weeks = config.GBA_ROUTINE_WAIT_WEEKS if has_ehcv else config.GBA_NO_EHCV_WAIT_WEEKS

    # 3) Return-to-HK burden ----------------------------------------------------------
    trips = estimate_return_trips(profile, dest)
    oneway = float(dest.get("border_oneway_hkd", 120) or 0)
    hours = float(dest.get("border_travel_hr", 1.5) or 0)
    return_burden_hkd = round(trips * 2 * oneway)
    return_burden_hours = round(trips * 2 * hours, 1)

    # 4) Projected wellbeing: composite OUTPUT (financial relief + care + continuity) --
    wellbeing = round(100.0 * (
        0.40 * float(subscores.get("financial", 0))
        + 0.30 * float(subscores.get("care", 0))
        + 0.30 * float(subscores.get("livability", 0))
    ), 1)

    return {
        "gross_savings_hkd": round(gross_savings),
        "lost_benefit_value_hkd": round(float(lost_benefit_value or 0)),
        "net_savings_hkd": round(net_savings),
        "monthly_savings_hkd": round(net_savings),   # the hero number = NET, honest
        "pct_income_freed": pct_income_freed,
        "runway_years": runway_years,
        "savings_sustainable": sustainable,
        "time_to_care_hk_weeks": round(hk_weeks),
        "time_to_care_gba_weeks": round(gba_weeks),
        "serious_care_note": "Serious / inpatient care: return to HK public hospital (entitlement kept).",
        "return_trips_per_year": round(trips, 1),
        "return_burden_hkd": return_burden_hkd,
        "return_burden_hours": return_burden_hours,
        "projected_wellbeing": wellbeing,
    }
