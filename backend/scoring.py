"""Matching score: resident profile × GBA destination → 0..100 + factor breakdown.

Honest reframing (see plan + value-prop memory): HK has world-class care QUALITY; the
pain is public-system WAITING TIMES and COST. So we do NOT score GBA care as "better".
A city is evaluated on four dimensions, weighted per persona:

  financial    — income + savings vs real cost of living (the headline)
  connectivity — return-to-HK burden: return frequency × per-city transport cost + time
  care         — care SPEED + affordability + EHCV-eligibility, with HK as the serious-care backstop
  livability   — Cantonese fit, mobility, environment, amenities

``compute_match_score(profile, dest) -> {score, factors, subscores}`` stays the stable
contract; ``rank_destinations`` additionally attaches the projections, the transparent
benefits ledger, warnings and provenance. Each factor is a transparent, monotonic
function so the resident view can explain *why* a city scored the way it did.
"""
from dataclasses import dataclass, asdict
from typing import Any

import config
import projections
import benefits
import weights as weights_mod

FACTOR_LABELS = {
    "financial":    ("Affordability & sustainability", "負擔能力及可持續"),
    "connectivity": ("Closeness to HK (returns)",       "返港便利"),
    "care":         ("Care access & speed",             "醫療可及及輪候"),
    "livability":   ("Livability & continuity",         "生活及文化配套"),
}


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


@dataclass
class ResidentProfile:
    # --- Finances (drive the financial dimension) ---
    monthly_income: float = 12000.0     # HKD / month, all sources
    savings: float = 200000.0           # HKD
    oaa_oala_monthly: float = 4345.0    # OALA, portable via Guangdong Scheme
    cssa_monthly: float = 0.0           # portable CSSA (forfeits public housing)
    has_hk_public_housing: bool = False
    wants_keep_public_housing: bool = False
    is_chinese_pr: bool = True          # Chinese-national PR keep right of abode indefinitely
    # --- Health / care (drive return frequency + care need) ---
    chronic_conditions: int = 0         # number of conditions on HA specialist follow-up
    chronic_specialty: str = "medicine" # maps to the real HA SOP wait
    care_level: int = 1                 # 0 none .. 3 high
    needs_residential_care: bool = False
    mobility_level: int = 1             # 0 independent .. 3 wheelchair
    needs_step_free: bool = False
    # --- Continuity / preferences (0..1) ---
    family_in_hk: float = 0.6
    pref_near_family: float = 0.5
    pref_cantonese: float = 0.5
    pref_green_space: float = 0.5
    pref_quiet: float = 0.5
    pref_community: float = 0.5
    # --- Legacy fields still accepted (mapped/ignored by the new model) ---
    monthly_budget: float = 0.0
    needs_clinic_nearby: bool = True

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "ResidentProfile":
        d = d or {}
        out = cls()
        for f in out.__dataclass_fields__:
            if f in d and d[f] is not None:
                cur = getattr(out, f)
                try:
                    if isinstance(cur, bool):
                        setattr(out, f, bool(d[f]))
                    elif isinstance(cur, int):
                        setattr(out, f, int(d[f]))
                    elif isinstance(cur, str):
                        setattr(out, f, str(d[f]))
                    else:
                        setattr(out, f, float(d[f]))
                except (TypeError, ValueError):
                    pass
        return out

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --------------------------------------------------------------- the 4 sub-scores


def _financial(p: ResidentProfile, dest: dict) -> float:
    """Can this senior live here sustainably on their income + savings? (income↑, savings↑ → score↑)"""
    income = projections.portable_income(p)
    cost = projections.city_cost(p, dest)
    surplus = income - cost
    # 1.0 - 0.5·cost/income: strictly increasing in income, 0.5 at parity, →1 when cost≪income.
    s = 1.0 - 0.5 * cost / max(income, 1.0)
    if surplus < 0:
        # Unaffordable on income alone: cap by how long savings bridge the gap (longer → higher).
        months = p.savings / max(-surplus, 1.0)
        s = min(s, 0.5 * _clamp01(months / 120.0))   # 10 years of runway → up to 0.5
    return _clamp01(s)


def _connectivity(p: ResidentProfile, dest: dict) -> float:
    """Return-to-HK burden: cheaper/closer cities win MORE the more often the senior must cross back."""
    trips = projections.estimate_return_trips(p, dest)
    oneway = float(dest.get("border_oneway_hkd", 120) or 0)
    hours = float(dest.get("border_travel_hr", 1.5) or 0)
    yearly_income = max(projections.portable_income(p) * 12, 1.0)
    cost_term = config.CONN_W_COST * (trips * 2 * oneway) / (config.CONN_COST_INCOME_FRAC * yearly_income)
    hours_term = config.CONN_W_HOURS * (trips * 2 * hours) / config.CONN_HOURS_BUDGET
    s = 1.0 - cost_term - hours_term
    # Inbound family-visit ease: a near border helps when family is in HK.
    prox = _clamp01(1 - hours / 4.0)
    fam = _clamp01(getattr(p, "family_in_hk", 0.6))
    s = s * (1 - 0.3 * fam) + 0.3 * fam * prox
    return _clamp01(s)


def _care(p: ResidentProfile, dest: dict) -> float:
    """Care SPEED + affordability + EHCV eligibility (+ GDRCS bed if needed). NOT a quality claim."""
    ehcv = _clamp01(int(dest.get("ehcv_points", 0) or 0) / 4.0)
    hours = float(dest.get("border_travel_hr", 1.5) or 0)
    safety_net = _clamp01(1 - hours / 4.0)            # reachability of HK serious-care backstop
    if p.needs_residential_care:
        residential = 1.0 if dest.get("gdrcs_available") else 0.25
        supply = 0.50 * residential + 0.30 * ehcv + 0.20 * safety_net
    else:
        speed = 0.8                                   # fast local routine access (modeled)
        supply = 0.40 * speed + 0.35 * ehcv + 0.25 * safety_net
    need = 0.4 + 0.6 * (p.care_level / 3.0)
    return _clamp01(supply * need + 0.5 * (1 - need))


def _livability(p: ResidentProfile, dest: dict) -> float:
    canton = _clamp01(dest.get("cantonese_env", 0.6))
    air = _clamp01(dest.get("air_quality", 0.6))
    green = _clamp01(dest.get("green_space", 0.6))
    amen = _clamp01(dest.get("amenity_density", 0.6))
    sf = _clamp01(dest.get("step_free_housing", 0.7))
    w = p.pref_cantonese + p.pref_green_space + p.pref_quiet + p.pref_community
    if w <= 0:
        base = 0.25 * (canton + air + green + amen)
    else:
        base = (p.pref_cantonese * canton + p.pref_green_space * green
                + p.pref_quiet * air + p.pref_community * amen) / w
    return _clamp01(0.85 * base + 0.15 * sf)          # small step-free nudge


_FACTOR_FNS = {
    "financial": _financial,
    "connectivity": _connectivity,
    "care": _care,
    "livability": _livability,
}


# --------------------------------------------------------------- orchestration


def compute_match_score(profile: ResidentProfile | dict, dest: dict, weights: dict | None = None) -> dict:
    """Return {score: 0..100, factors: [...], subscores: {key: value}}.

    ``score = 100 * Σ weight_k * value_k`` with each value in [0,1].
    """
    if not isinstance(profile, ResidentProfile):
        profile = ResidentProfile.from_dict(profile)
    weights = weights or config.SCORING_WEIGHTS

    factors, subscores, score = [], {}, 0.0
    for key, weight in weights.items():
        value = _clamp01(_FACTOR_FNS[key](profile, dest))
        subscores[key] = round(value, 3)
        contribution = weight * value * 100.0
        score += contribution
        label_en, label_tc = FACTOR_LABELS[key]
        factors.append({
            "key": key,
            "label_en": label_en,
            "label_tc": label_tc,
            "weight": round(weight, 3),
            "value": round(value, 3),
            "contribution": round(contribution, 1),
        })
    return {"score": round(_clamp01(score / 100.0) * 100.0, 1), "factors": factors, "subscores": subscores}


def _apply_filters(p: ResidentProfile, dest: dict, score: float) -> tuple[float, list[str]]:
    """Hard filters / penalties layered on top of the weighted score."""
    warnings: list[str] = []
    if p.needs_step_free or p.mobility_level >= 2:
        sf = _clamp01(dest.get("step_free_housing", 0.7))
        if sf < config.STEP_FREE_GATE:
            score *= sf / config.STEP_FREE_GATE
            warnings.append("Limited step-free housing here for your mobility needs.")
    if p.needs_residential_care and not dest.get("gdrcs_available"):
        score *= 0.85
    return round(score, 1), warnings


def rank_destinations(profile: ResidentProfile | dict, destinations: list[dict],
                      persona: str | None = None) -> list[dict]:
    """Score every destination and return them best-first, each enriched with the
    projections, transparent benefits ledger, warnings and provenance."""
    if not isinstance(profile, ResidentProfile):
        profile = ResidentProfile.from_dict(profile)
    persona_name, w = weights_mod.resolve(profile, persona)

    ranked = []
    for dest in destinations:
        match = compute_match_score(profile, dest, w)
        ledger = benefits.build_ledger(profile, dest)
        proj = projections.compute(profile, dest, ledger["lost_benefit_value_hkd"], match["subscores"])
        match["score"], filt_warnings = _apply_filters(profile, dest, match["score"])
        ranked.append({
            **dest,
            "match": match,
            **proj,
            "benefits_ledger": ledger["benefits_ledger"],
            "warnings": ledger["warnings"] + filt_warnings,
            "persona": persona_name,
            "data_provenance": config.PROVENANCE,
        })
    ranked.sort(key=lambda d: d["match"]["score"], reverse=True)
    return ranked
