"""Populate same-city cohorts so the community feature demos well.

  1. Opts every existing non-rejected application into its city cohort.
  2. Adds a few extra opted-in 'companion' seniors to one flagship city (Zhuhai)
     so a resident matched there sees a real, non-empty cohort.

Idempotent: companions are tagged with a sentinel origin and skipped if present.
Run from backend/:  python seed_cohorts.py
"""
import json
from datetime import datetime, timedelta, timezone

import config
import db
import scoring

_SENTINEL = "[cohort-seed]"

# Extra opted-in members for the Zhuhai cohort (status, days_ago, name, profile_dest_id, profile)
_COMPANIONS = [
    ("moved", 40, "Mrs Ho Yuk-ching", "zhuhai",
     dict(monthly_income=9800, savings=210000, oaa_oala_monthly=4345, is_chinese_pr=True,
          chronic_conditions=1, chronic_specialty="medicine", care_level=1,
          needs_step_free=True, mobility_level=1, family_in_hk=0.6, pref_near_family=0.6,
          pref_cantonese=0.7, pref_green_space=0.7, pref_quiet=0.7, pref_community=0.8)),
    ("approved", 18, "Mr Kwok Chi-fai", "zhuhai",
     dict(monthly_income=11500, savings=300000, oaa_oala_monthly=1675, is_chinese_pr=True,
          chronic_conditions=0, care_level=0, needs_step_free=False, mobility_level=0,
          family_in_hk=0.5, pref_near_family=0.5, pref_cantonese=0.8, pref_green_space=0.85,
          pref_quiet=0.85, pref_community=0.6)),
    ("approved", 25, "Mrs Yeung Lai-fong", "zhuhai",
     dict(monthly_income=8800, savings=140000, oaa_oala_monthly=4345, is_chinese_pr=True,
          chronic_conditions=1, chronic_specialty="eye", care_level=1, needs_step_free=True,
          mobility_level=1, family_in_hk=0.7, pref_near_family=0.7, pref_cantonese=0.9,
          pref_green_space=0.6, pref_quiet=0.7, pref_community=0.85)),
]


def main() -> None:
    destinations = json.loads(config.DESTINATIONS_JSON.read_text(encoding="utf-8"))
    db.init_db()
    conn = db.connect()

    # 1) opt every existing non-rejected application into its cohort
    n = conn.execute(
        "UPDATE applications SET cohort_optin=1 WHERE status != 'rejected'"
    ).rowcount

    # 2) add flagship companions (idempotent)
    now = datetime.now(timezone.utc)
    added = 0
    for status, days_ago, name, dest_id, profile in _COMPANIONS:
        if conn.execute(
            "SELECT 1 FROM applications WHERE applicant_name=? AND origin_address=?",
            (name, _SENTINEL),
        ).fetchone():
            continue
        ranked = scoring.rank_destinations(profile, destinations)
        chosen = next((d for d in ranked if d["id"] == dest_id), None)
        if not chosen:
            continue
        ordered = [chosen] + [d for d in ranked if d["id"] != dest_id]
        created_dt = now - timedelta(days=days_ago)
        decided_at = (created_dt + timedelta(days=max(1, days_ago - 6))).isoformat()
        moved_at = (created_dt + timedelta(days=max(2, days_ago - 3))).isoformat() if status == "moved" else None
        conn.execute(
            """INSERT INTO applications
               (created_at, status, applicant_name, origin_address,
                profile_json, destinations_json, note, decided_at, moved_at, cohort_optin)
               VALUES (?,?,?,?,?,?,?,?,?,1)""",
            (created_dt.isoformat(), status, name, _SENTINEL,
             json.dumps(profile, ensure_ascii=False),
             json.dumps(ordered, ensure_ascii=False),
             None, decided_at, moved_at),
        )
        added += 1

    conn.commit()
    conn.close()
    print(f"Opted-in {n} existing applications; added {added} flagship companions.")


if __name__ == "__main__":
    main()
