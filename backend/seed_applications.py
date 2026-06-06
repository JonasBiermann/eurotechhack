"""Seed realistic mock applications so a fresh DB demos well.

Inserts a handful of plausible HK senior applications spread across all four
statuses (submitted / under_review / approved / rejected), with the match
score computed against the chosen HK new-town destination via scoring.py.

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


# Each entry: (status, days_ago, applicant, origin, dest_id, profile, docs, note)
SEED = [
    (
        "submitted", 1,
        "Mr Chan Tai-man", "Flat 4B, 23 Pei Ho Street, Sham Shui Po",
        "kwu_tung_north",
        dict(monthly_income=9500, savings=80000, monthly_budget=5500,
             needs_step_free=True, mobility_level=2,
             care_level=1, needs_clinic_nearby=True,
             pref_near_family=0.8, pref_green_space=0.5,
             pref_community=0.7, pref_quiet=0.4),
        ["HKID.pdf", "Medical_report_Jul2026.pdf", "Income_proof.pdf"],
        None,
    ),
    (
        "submitted", 2,
        "Mrs Wong Mei-lin", "Flat 7A, 145 Tai Nan Street, Sham Shui Po",
        "fanling_north",
        dict(monthly_income=8200, savings=45000, monthly_budget=4800,
             needs_step_free=True, mobility_level=1,
             care_level=2, needs_clinic_nearby=True,
             pref_near_family=0.9, pref_green_space=0.3,
             pref_community=0.85, pref_quiet=0.6),
        ["HKID.pdf", "CSSA_letter.pdf"],
        None,
    ),
    (
        "submitted", 4,
        "Mr Lau Ka-wai", "Flat 12C, 88 Yee Kuk Street, Sham Shui Po",
        "hung_shui_kiu",
        dict(monthly_income=11000, savings=160000, monthly_budget=6500,
             needs_step_free=False, mobility_level=0,
             care_level=0, needs_clinic_nearby=False,
             pref_near_family=0.4, pref_green_space=0.9,
             pref_community=0.5, pref_quiet=0.95),
        ["HKID.pdf", "Bank_statement.pdf", "Tax_demand.pdf"],
        None,
    ),
    (
        "under_review", 6,
        "Mrs Cheung Yuet-fong", "Flat 3D, 56 Ngau Tau Kok Road, Kwun Tong",
        "tung_chung_east",
        dict(monthly_income=7400, savings=22000, monthly_budget=4200,
             needs_step_free=True, mobility_level=3,
             care_level=3, needs_clinic_nearby=True,
             pref_near_family=0.6, pref_green_space=0.7,
             pref_community=0.8, pref_quiet=0.8),
        ["HKID.pdf", "Hospital_discharge.pdf", "Carer_statement.pdf"],
        "Awaiting confirmation from Tung Chung clinic on intake date.",
    ),
    (
        "under_review", 9,
        "Mr Ng Sai-keung", "Flat 9F, 201 Nam Cheong Street, Sham Shui Po",
        "yuen_long_south",
        dict(monthly_income=12000, savings=240000, monthly_budget=7800,
             needs_step_free=False, mobility_level=1,
             care_level=1, needs_clinic_nearby=True,
             pref_near_family=0.5, pref_green_space=0.85,
             pref_community=0.6, pref_quiet=0.9),
        ["HKID.pdf", "Medical_report.pdf"],
        "Pending family visit assessment.",
    ),
    (
        "approved", 14,
        "Mrs Lee Siu-mei", "Flat 18A, 12 Tai Yuen Street, Wan Chai",
        "kwu_tung_north",
        dict(monthly_income=10500, savings=320000, monthly_budget=7000,
             needs_step_free=True, mobility_level=1,
             care_level=1, needs_clinic_nearby=True,
             pref_near_family=0.7, pref_green_space=0.6,
             pref_community=0.8, pref_quiet=0.7),
        ["HKID.pdf", "Medical_report.pdf", "Income_proof.pdf", "Existing_lease.pdf"],
        "Approved. Move-in scheduled for 15 Aug 2026.",
    ),
    (
        "approved", 21,
        "Mr Tam Chi-ho", "Flat 5B, 34 Hennessy Road, Wan Chai",
        "fanling_north",
        dict(monthly_income=14000, savings=480000, monthly_budget=8500,
             needs_step_free=False, mobility_level=0,
             care_level=0, needs_clinic_nearby=False,
             pref_near_family=0.3, pref_green_space=0.7,
             pref_community=0.4, pref_quiet=0.8),
        ["HKID.pdf", "Bank_statement.pdf"],
        "Approved — independent unit allocation.",
    ),
    (
        "rejected", 11,
        "Mr Pang Wing-fai", "Flat 22C, 78 Kwun Tong Road, Kwun Tong",
        "san_tin",
        dict(monthly_income=4200, savings=8000, monthly_budget=3000,
             needs_step_free=True, mobility_level=3,
             care_level=3, needs_clinic_nearby=True,
             pref_near_family=0.95, pref_green_space=0.4,
             pref_community=0.7, pref_quiet=0.5),
        ["HKID.pdf"],
        "Care needs exceed current San Tin intake capacity. "
        "Re-routed to community care coordinator for an alternative.",
    ),
]


def _load_new_towns() -> dict:
    with open(config.NEW_TOWNS_JSON, "r", encoding="utf-8") as f:
        return {nt["id"]: nt for nt in json.load(f)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true",
                        help="delete existing applications first")
    args = parser.parse_args()

    new_towns = _load_new_towns()
    db.init_db()
    conn = db.connect()

    if args.reset:
        conn.execute("DELETE FROM documents")
        conn.execute("DELETE FROM applications")
        print("Cleared existing applications.")

    now = datetime.now(timezone.utc)
    inserted = 0
    for status, days_ago, name, origin, dest_id, profile, docs, note in SEED:
        nt = new_towns.get(dest_id)
        if not nt:
            print(f"  skip {name}: unknown dest {dest_id}", file=sys.stderr)
            continue
        match = scoring.compute_match_score(profile, nt)
        chosen = {**nt, "match": match}
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
             json.dumps([chosen], ensure_ascii=False),
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
    print(f"Inserted {inserted} mock applications.")


if __name__ == "__main__":
    main()
