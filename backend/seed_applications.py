"""Seed realistic mock applications so a fresh DB demos well.

Inserts a handful of plausible HK senior applications spread across all four
statuses (submitted / under_review / approved / rejected), each relocating to a
Greater Bay Area city, with the match + projections + benefits ledger computed by
scoring.rank_destinations (so the gov console shows real GBA matches).

Run from backend/:  python seed_applications.py [--reset]

  --reset  delete existing applications first (default keeps them).
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

import config
import db
import scoring


# Each entry: (status, days_ago, applicant, origin, gba_dest_id, profile, docs, note)
SEED = [
    (
        "submitted", 1,
        "Mr Chan Tai-man", "Flat 4B, 23 Pei Ho Street, Sham Shui Po",
        "shenzhen",
        dict(monthly_income=9500, savings=80000, oaa_oala_monthly=1675, cssa_monthly=0,
             has_hk_public_housing=True, is_chinese_pr=True,
             chronic_conditions=1, chronic_specialty="medicine", care_level=1,
             needs_step_free=True, mobility_level=2,
             family_in_hk=0.8, pref_near_family=0.9, pref_cantonese=0.5,
             pref_green_space=0.5, pref_quiet=0.4, pref_community=0.7),
        ["HKID.pdf", "Medical_report_Jul2026.pdf", "Income_proof.pdf"],
        None,
    ),
    (
        "submitted", 2,
        "Mrs Wong Mei-lin", "Flat 7A, 145 Tai Nan Street, Sham Shui Po",
        "zhongshan",
        dict(monthly_income=8200, savings=45000, oaa_oala_monthly=0, cssa_monthly=4500,
             has_hk_public_housing=True, is_chinese_pr=True,
             chronic_conditions=1, chronic_specialty="medicine", care_level=2,
             needs_step_free=True, mobility_level=1,
             family_in_hk=0.9, pref_near_family=0.9, pref_cantonese=1.0,
             pref_green_space=0.3, pref_quiet=0.6, pref_community=0.85),
        ["HKID.pdf", "CSSA_letter.pdf"],
        None,
    ),
    (
        "submitted", 4,
        "Mr Lau Ka-wai", "Flat 12C, 88 Yee Kuk Street, Sham Shui Po",
        "huizhou",
        dict(monthly_income=11000, savings=160000, oaa_oala_monthly=1675, cssa_monthly=0,
             has_hk_public_housing=False, is_chinese_pr=True,
             chronic_conditions=0, care_level=0,
             needs_step_free=False, mobility_level=0,
             family_in_hk=0.4, pref_near_family=0.4, pref_cantonese=0.5,
             pref_green_space=0.9, pref_quiet=0.95, pref_community=0.5),
        ["HKID.pdf", "Bank_statement.pdf", "Tax_demand.pdf"],
        None,
    ),
    (
        "under_review", 6,
        "Mrs Cheung Yuet-fong", "Flat 3D, 56 Ngau Tau Kok Road, Kwun Tong",
        "zhongshan",
        dict(monthly_income=7400, savings=22000, oaa_oala_monthly=4345, cssa_monthly=0,
             has_hk_public_housing=False, is_chinese_pr=True,
             chronic_conditions=2, chronic_specialty="orthopaedics", care_level=3,
             needs_residential_care=True, needs_step_free=True, mobility_level=3,
             family_in_hk=0.6, pref_near_family=0.6, pref_cantonese=0.8,
             pref_green_space=0.7, pref_quiet=0.8, pref_community=0.8),
        ["HKID.pdf", "Hospital_discharge.pdf", "Carer_statement.pdf"],
        "Awaiting confirmation from the Zhongshan GDRCS care home on intake date.",
    ),
    (
        "under_review", 9,
        "Mr Ng Sai-keung", "Flat 9F, 201 Nam Cheong Street, Sham Shui Po",
        "zhuhai",
        dict(monthly_income=12000, savings=240000, oaa_oala_monthly=1675, cssa_monthly=0,
             has_hk_public_housing=False, is_chinese_pr=True,
             chronic_conditions=1, chronic_specialty="eye", care_level=1,
             needs_step_free=False, mobility_level=1,
             family_in_hk=0.5, pref_near_family=0.5, pref_cantonese=0.6,
             pref_green_space=0.85, pref_quiet=0.9, pref_community=0.6),
        ["HKID.pdf", "Medical_report.pdf"],
        "Pending family visit assessment.",
    ),
    (
        "approved", 14,
        "Mrs Lee Siu-mei", "Flat 18A, 12 Tai Yuen Street, Wan Chai",
        "zhuhai",
        dict(monthly_income=10500, savings=320000, oaa_oala_monthly=4345, cssa_monthly=0,
             has_hk_public_housing=False, is_chinese_pr=True,
             chronic_conditions=1, chronic_specialty="medicine", care_level=1,
             needs_step_free=True, mobility_level=1,
             family_in_hk=0.7, pref_near_family=0.7, pref_cantonese=0.7,
             pref_green_space=0.6, pref_quiet=0.7, pref_community=0.8),
        ["HKID.pdf", "Medical_report.pdf", "Income_proof.pdf", "Existing_lease.pdf"],
        "Approved. Move-in scheduled for 15 Aug 2026.",
    ),
    (
        "approved", 21,
        "Mr Tam Chi-ho", "Flat 5B, 34 Hennessy Road, Wan Chai",
        "jiangmen",
        dict(monthly_income=14000, savings=480000, oaa_oala_monthly=1675, cssa_monthly=0,
             has_hk_public_housing=False, is_chinese_pr=True,
             chronic_conditions=0, care_level=0,
             needs_step_free=False, mobility_level=0,
             family_in_hk=0.3, pref_near_family=0.3, pref_cantonese=0.9,
             pref_green_space=0.7, pref_quiet=0.8, pref_community=0.4),
        ["HKID.pdf", "Bank_statement.pdf"],
        "Approved — independent living, ancestral-home district.",
    ),
    (
        "rejected", 11,
        "Mr Pang Wing-fai", "Flat 22C, 78 Kwun Tong Road, Kwun Tong",
        "foshan",
        dict(monthly_income=4200, savings=8000, oaa_oala_monthly=4345, cssa_monthly=4500,
             has_hk_public_housing=True, is_chinese_pr=True,
             chronic_conditions=3, chronic_specialty="medicine", care_level=3,
             needs_residential_care=True, needs_step_free=True, mobility_level=3,
             family_in_hk=0.95, pref_near_family=0.95, pref_cantonese=0.9,
             pref_green_space=0.4, pref_quiet=0.5, pref_community=0.7),
        ["HKID.pdf"],
        "High care needs plus very frequent HK follow-ups make a far city unsuitable; "
        "re-routed to a border-proximate option and community care coordinator.",
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true",
                        help="delete existing applications first")
    args = parser.parse_args()

    destinations = json.loads(config.DESTINATIONS_JSON.read_text(encoding="utf-8"))
    db.init_db()
    conn = db.connect()

    if args.reset:
        conn.execute("DELETE FROM documents")
        conn.execute("DELETE FROM applications")
        print("Cleared existing applications.")

    now = datetime.now(timezone.utc)
    inserted = 0
    for status, days_ago, name, origin, dest_id, profile, docs, note in SEED:
        ranked = scoring.rank_destinations(profile, destinations)
        chosen = next((d for d in ranked if d["id"] == dest_id), None)
        if not chosen:
            print(f"  skip {name}: unknown GBA dest {dest_id}", file=sys.stderr)
            continue
        # honour the applicant's first choice, then the rest of the ranking
        ordered = [chosen] + [d for d in ranked if d["id"] != dest_id]
        created_at = (now - timedelta(days=days_ago)).isoformat()
        decided_at = (now - timedelta(days=max(0, days_ago - 1))).isoformat() \
            if status in ("approved", "rejected") else None

        cur = conn.execute(
            """INSERT INTO applications
               (created_at, status, applicant_name, origin_address,
                profile_json, destinations_json, note, decided_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (created_at, status, name, origin,
             json.dumps(profile, ensure_ascii=False),
             json.dumps(ordered, ensure_ascii=False),
             note, decided_at),
        )
        app_id = cur.lastrowid
        for fname in docs:
            conn.execute(
                """INSERT INTO documents
                   (application_id, filename, stored_path, size, content_type, uploaded_at)
                   VALUES (?,?,?,?,?,?)""",
                (app_id, fname, "", 120_000 + (hash(fname) & 0x3FFFF),
                 "application/pdf", created_at),
            )
        inserted += 1

    conn.commit()
    conn.close()
    print(f"Inserted {inserted} mock GBA applications.")


if __name__ == "__main__":
    main()
