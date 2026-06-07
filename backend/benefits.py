"""Benefits Ledger — 100% transparent account of what a senior KEEPS, GAINS, LOSES,
and RISKS by relocating. This is the trust-first / anti-scam core of OnKui: we
never hide a downside, every entry is sourced, and quantifiable losses are netted
into the hero savings number.

`build_ledger(profile, dest)` filters a gov-sourced catalog down to the entries that
actually apply to *this* senior at *this* city, and returns the list plus the total
monthly value of losses (to net out) and any hard warnings.

Status values: kept | gained | lost | at_risk | reduced.
All amounts in HK$/month. Allowance amounts are real (swd.gov.hk); implicit subsidy
values are modeled (see config).
"""
import config


def _entry(name, status, *, value=None, condition="", detail="", source="", provenance="hardcoded"):
    return {
        "name": name,
        "status": status,
        "monthly_value_hkd": (round(value) if value is not None else None),
        "condition": condition,
        "detail": detail,
        "source": source,
        "provenance": provenance,
    }


def build_ledger(profile, dest: dict) -> dict:
    ledger: list[dict] = []
    warnings: list[str] = []

    oaa_oala = float(getattr(profile, "oaa_oala_monthly", 0) or 0)
    cssa = float(getattr(profile, "cssa_monthly", 0) or 0)
    has_ph = bool(getattr(profile, "has_hk_public_housing", False))
    is_cpr = bool(getattr(profile, "is_chinese_pr", True))
    needs_residential = bool(getattr(profile, "needs_residential_care", False))
    ehcv_points = int(dest.get("ehcv_points", 0) or 0)
    gdrcs = bool(dest.get("gdrcs_available", False))
    hours = float(dest.get("border_travel_hr", 1.5) or 0)

    # ---- KEPT (portable, with conditions) --------------------------------------
    if oaa_oala > 0:
        ledger.append(_entry(
            "Old Age / Living Allowance (OAA/OALA)", "kept", value=oaa_oala,
            condition="Reside ≥ 60 days/yr in Guangdong (Guangdong Scheme); no mandatory HK return.",
            detail="Allowance stays payable cross-border; pro-rated only if the 60-day threshold is unmet.",
            source="swd.gov.hk — Guangdong Scheme"))

    if cssa > 0:
        ledger.append(_entry(
            "Comprehensive Social Security Assistance (portable)", "kept", value=cssa,
            condition="≤ 180 days/yr absence from HK (elderly rate).",
            detail="Payable via the Portable CSSA Scheme while living in Guangdong/Fujian.",
            source="swd.gov.hk — Portable CSSA"))

    ledger.append(_entry(
        "HK right of abode / permanent residency",
        "kept" if is_cpr else "at_risk",
        condition=("Retained indefinitely for Chinese-national permanent residents."
                   if is_cpr else "Non-Chinese PR: lost after ≥ 36 months continuous absence."),
        detail="PR status anchors your HK public-hospital eligibility (below).",
        source="immd.gov.hk — Right of Abode"))

    ledger.append(_entry(
        "HK public-hospital safety net (“Eligible Person”)",
        "kept" if is_cpr else "at_risk",
        condition="Serious / specialist / inpatient care: return to HK (entitlement kept while PR).",
        detail=f"Reachable in ~{hours:.1f}h one-way from this city.",
        source="ha.org.hk — Eligible Persons"))

    ledger.append(_entry(
        "eHealth cross-border medical record", "kept",
        detail="Your HK records transfer to designated GBA hospitals for follow-up.",
        source="bayarea.gov.hk — Medical co-operation"))

    # ---- GAINED ----------------------------------------------------------------
    if ehcv_points > 0:
        inst = dest.get("ehcv_institution") or "a designated GBA institution"
        ledger.append(_entry(
            "Elderly Health Care Voucher usable locally", "gained",
            value=config.EHCV_ANNUAL_HKD / 12.0,
            condition=f"Spend at {inst} ({ehcv_points} designated service point(s) in this city).",
            detail="HK$2,000/yr (+ up to HK$500 reward) for primary, chronic & dental care. Excludes inpatient/surgery.",
            source="hcv.gov.hk — EHCV GBA Pilot"))

    if needs_residential and gdrcs:
        ledger.append(_entry(
            "GDRCS subsidised care home (≈ free core services)", "gained",
            value=float(dest.get("care_home_private_hkd", 4000) or 0),
            condition="Place in a Guangdong Residential Care Services Scheme home.",
            detail="HK-funded; accommodation, meals & 24h care covered — you pay only consumables.",
            source="swd.gov.hk — GDRCS", provenance="hardcoded"))

    # ---- LOST / FORFEITED ------------------------------------------------------
    if has_ph and cssa > 0:
        ledger.append(_entry(
            "HK public housing", "lost", value=config.PUBLIC_HOUSING_SUBSIDY_HKD,
            condition="Forfeited when taking Portable CSSA / Guangdong Scheme; cannot re-apply.",
            detail="Implicit rent subsidy lost (modeled). This is netted into your net savings.",
            source="swd.gov.hk / Housing Authority", provenance="modeled"))
        warnings.append("Taking portable CSSA forfeits your HK public housing — you cannot re-apply.")
    elif has_ph:
        ledger.append(_entry(
            "HK public housing tenancy", "at_risk",
            condition="Must remain your principal residence; prolonged absence risks repossession.",
            detail="Self-funded relocation keeps the flat only if you keep living in it principally.",
            source="Housing Authority — tenancy"))

    ledger.append(_entry(
        "HK community care services + $2 transport", "lost",
        value=config.COMMUNITY_SERVICES_HKD,
        condition="HK-only; day-care, home help, meal delivery and the JoyYou $2 fare are not portable.",
        detail="Modeled monthly value; netted into net savings.",
        source="swd.gov.hk / MTR JoyYou", provenance="modeled"))

    ledger.append(_entry(
        "Convenient HK-hospital access for serious care", "reduced",
        condition="Still entitled, but now a cross-border trip; EHCV excludes inpatient & surgery.",
        detail="Routine care moves local; serious care stays in HK (see safety net).",
        source="hcv.gov.hk / ha.org.hk"))

    # ---- conditional warnings --------------------------------------------------
    if needs_residential and not gdrcs:
        warnings.append("No subsidised (GDRCS) care bed at this destination — private care-home fees apply.")
    if not is_cpr:
        warnings.append("Non-Chinese PR: ≥ 36 months continuous absence ends right of abode and HK hospital eligibility.")

    lost_value = sum(
        e["monthly_value_hkd"] for e in ledger
        if e["status"] in ("lost", "reduced") and e["monthly_value_hkd"]
    )

    return {
        "benefits_ledger": ledger,
        "lost_benefit_value_hkd": round(float(lost_value)),
        "warnings": warnings,
    }
