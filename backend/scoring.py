"""Matching score: resident profile × GBA destination → 0..100 + factor breakdown.

This module is the SINGLE swap-point for a future ML model. Keep the contract
``compute_match_score(profile, dest) -> dict`` and the factor keys stable; replace
the body with a model and nothing else (API, UI) needs to change.

Every factor is a transparent, monotonic function of the inputs so the resident
view can explain *why* a city scored the way it did.
"""
from dataclasses import dataclass, asdict
from typing import Any

import config

FACTOR_LABELS = {
    "affordability": ("Affordability", "負擔能力"),
    "accessibility": ("Step-free access", "無障礙設施"),
    "care_access":   ("Care & healthcare", "照顧及醫療"),
    "lifestyle_fit": ("Lifestyle fit", "生活配套"),
    "proximity":     ("Closeness to HK", "鄰近香港"),
}


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


@dataclass
class ResidentProfile:
    # Finances
    monthly_income: float = 15000.0     # HKD / month
    savings: float = 200000.0           # HKD
    monthly_budget: float = 8000.0      # HKD / month for housing + care
    # Mobility & access
    needs_step_free: bool = False
    mobility_level: int = 1             # 0 independent .. 3 wheelchair
    # Care & health
    care_level: int = 1                # 0 none .. 3 high
    needs_clinic_nearby: bool = True
    # Lifestyle preferences (0..1 importance)
    pref_near_family: float = 0.5
    pref_green_space: float = 0.5
    pref_community: float = 0.5
    pref_quiet: float = 0.5

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
                    else:
                        setattr(out, f, float(d[f]))
                except (TypeError, ValueError):
                    pass
        return out

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _affordability(p: ResidentProfile, dest: dict) -> float:
    cost = float(dest.get("monthly_cost", 8000) or 8000)
    budget = max(float(p.monthly_budget or 1.0), 1.0)
    # Strictly increasing in budget. ~1.0 when cost well under budget, 0.5 at parity.
    return _clamp01(1.1 - 0.6 * cost / budget)


def _accessibility(p: ResidentProfile, dest: dict) -> float:
    avail = _clamp01(dest.get("step_free_housing", 0.7))
    if p.needs_step_free or p.mobility_level >= 2:
        return avail                      # critical: fully gated by availability
    return _clamp01(0.5 + 0.5 * avail)    # nice-to-have


def _care_access(p: ResidentProfile, dest: dict) -> float:
    capacity = _clamp01(dest.get("care_capacity", 0.6))
    health = _clamp01(dest.get("healthcare_score", 0.7))
    supply = (0.4 * capacity + 0.6 * health) if p.needs_clinic_nearby else (0.5 * capacity + 0.5 * health)
    need = 0.4 + 0.6 * (p.care_level / 3.0)
    return _clamp01(supply * need + 0.5 * (1 - need))


def _lifestyle_fit(p: ResidentProfile, dest: dict) -> float:
    liv = _clamp01(dest.get("livability", 0.6))
    comm = _clamp01(dest.get("hk_community", 0.6))
    w = p.pref_green_space + p.pref_community + p.pref_quiet
    if w <= 0:
        return _clamp01(0.5 * liv + 0.5 * comm)
    val = (p.pref_green_space * liv
           + p.pref_community * comm
           + p.pref_quiet * (0.4 + 0.6 * liv)) / w
    return _clamp01(val)


def _proximity(p: ResidentProfile, dest: dict) -> float:
    hours = float(dest.get("travel_time_hr", 2.0) or 2.0)
    base = _clamp01(1 - hours / 4.0)      # 0h→1, 4h→0
    return _clamp01(base * (0.4 + 0.6 * p.pref_near_family) + 0.4 * (1 - p.pref_near_family))


_FACTOR_FNS = {
    "affordability": _affordability,
    "accessibility": _accessibility,
    "care_access": _care_access,
    "lifestyle_fit": _lifestyle_fit,
    "proximity": _proximity,
}


def compute_match_score(profile: ResidentProfile | dict, dest: dict) -> dict:
    """Return {score: 0..100, factors: [{key,label_en,label_tc,weight,value,contribution}]}.

    ``score = 100 * Σ weight_k * value_k`` with each value in [0,1].
    """
    if not isinstance(profile, ResidentProfile):
        profile = ResidentProfile.from_dict(profile)

    factors = []
    score = 0.0
    for key, weight in config.SCORING_WEIGHTS.items():
        value = _clamp01(_FACTOR_FNS[key](profile, dest))
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
    return {"score": round(_clamp01(score / 100.0) * 100.0, 1), "factors": factors}


def rank_destinations(profile: ResidentProfile | dict, destinations: list[dict]) -> list[dict]:
    """Score every destination and return them sorted best-first."""
    if not isinstance(profile, ResidentProfile):
        profile = ResidentProfile.from_dict(profile)
    ranked = []
    for dest in destinations:
        result = compute_match_score(profile, dest)
        ranked.append({**dest, "match": result})
    ranked.sort(key=lambda d: d["match"]["score"], reverse=True)
    return ranked
