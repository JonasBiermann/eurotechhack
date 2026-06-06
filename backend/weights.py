"""Persona weight profiles for the 4-dimension match score.

Different seniors weight the dimensions differently, so the same city ranks
differently per persona — a frugal healthy senior is steered to a cheap, distant
city; a chronic, HK-anchored senior to a border-proximate one. The active profile
is auto-selected from the resident's situation, or overridden explicitly via the API.

Dimensions: financial, connectivity (return-to-HK burden), care (speed+access, not
quality), livability. Each profile sums to 1.0.
"""
import config

PERSONA_WEIGHTS = {
    # The default: a balanced view (mirrors config.SCORING_WEIGHTS).
    "balanced":            dict(config.SCORING_WEIGHTS),
    # Low income/savings, healthy, rarely returns → cost dominates (cheap distant cities OK).
    "frugal_healthy":      {"financial": 0.50, "connectivity": 0.15, "care": 0.15, "livability": 0.20},
    # Chronic condition on HA follow-up, returns to HK often → connectivity + care-speed.
    "chronic_hk_anchored": {"financial": 0.25, "connectivity": 0.30, "care": 0.35, "livability": 0.10},
    # High care need / needs residential care → care (GDRCS bed) dominates.
    "frail_residential":   {"financial": 0.30, "connectivity": 0.20, "care": 0.40, "livability": 0.10},
    # Healthy but wants easy family visits + Cantonese environment → continuity/connectivity.
    "family_oriented":     {"financial": 0.25, "connectivity": 0.35, "care": 0.20, "livability": 0.20},
}


def auto_select(profile) -> str:
    """Pick the persona that best fits the resident's situation.

    ``profile`` is a ResidentProfile (read via getattr so a plain dict-ish also works).
    """
    care_level = int(getattr(profile, "care_level", 1) or 0)
    chronic = int(getattr(profile, "chronic_conditions", 0) or 0)
    needs_residential = bool(getattr(profile, "needs_residential_care", False))
    income = float(getattr(profile, "monthly_income", 12000) or 0)
    fam = float(getattr(profile, "family_in_hk", 0.6) or 0)
    pref_fam = float(getattr(profile, "pref_near_family", 0.5) or 0)

    if needs_residential or care_level >= 3:
        return "frail_residential"
    if chronic >= 1:
        return "chronic_hk_anchored"
    if pref_fam >= 0.6 and fam >= 0.6:
        return "family_oriented"
    if income <= 8000:
        return "frugal_healthy"
    return "balanced"


def resolve(profile, persona: str | None = None) -> tuple[str, dict]:
    """Return (profile_name, normalized weights). Explicit persona wins if valid.

    A small dynamic nudge bumps care + connectivity when the senior has chronic
    conditions, even on top of the chosen profile, then re-normalizes to sum 1.0.
    """
    name = persona if persona in PERSONA_WEIGHTS else auto_select(profile)
    w = dict(PERSONA_WEIGHTS[name])

    chronic = int(getattr(profile, "chronic_conditions", 0) or 0)
    if chronic >= 1:
        bump = min(0.05 * chronic, 0.15)
        w["care"] = w.get("care", 0) + bump
        w["connectivity"] = w.get("connectivity", 0) + bump

    total = sum(w.values()) or 1.0
    return name, {k: round(v / total, 4) for k, v in w.items()}
