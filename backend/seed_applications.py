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


# Each entry: (status, days_ago, applicant, origin, gba_dest_id, profile, docs, note, events)
#   events: list of (offset_days_after_create, kind, author, title_en, title_tc, body)
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到",
             "Submitted via OnKui resident portal."),
            (0.02, "document", "Resident",
             "Documents uploaded (3)", "已上載文件（3 份）",
             "HKID, July 2026 medical report, income proof."),
            (0.10, "note", "Officer Lam",
             "Initial triage", "初步分流",
             "Walks with a cane and lives on the 4/F of a no-lift walk-up. "
             "Step-free Shenzhen unit is a strong fit."),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.05, "document", "Resident",
             "Documents uploaded (2)", "已上載文件（2 份）",
             "HKID, CSSA letter."),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.05, "document", "Resident",
             "Documents uploaded (3)", "已上載文件（3 份）", None),
            (1.20, "note", "Officer Lam",
             "Lifestyle preference noted", "已記錄生活偏好",
             "Resident is independent and explicitly prefers a quieter, "
             "greener neighbourhood. Huizhou fits the brief well."),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.10, "document", "Resident",
             "Documents uploaded (3)", "已上載文件（3 份）",
             "HKID, hospital discharge summary, carer statement."),
            (1.00, "status", "Officer Lam",
             "Marked for review", "列為審核中",
             "High care need + recent hospital discharge — flagged for caseworker assessment."),
            (2.50, "contact", "Officer Lam",
             "Phone call with daughter", "與女兒通話",
             "Daughter confirmed family can support fortnightly cross-border visits to Zhongshan."),
            (4.20, "followup", "Officer Lam",
             "Awaiting care home intake date", "等待院舍收症日期",
             "Awaiting confirmation from the Zhongshan GDRCS care home on intake date."),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.30, "document", "Resident",
             "Documents uploaded (2)", "已上載文件（2 份）", None),
            (2.00, "status", "Officer Lam",
             "Marked for review", "列為審核中", None),
            (4.10, "contact", "Officer Lam",
             "Outreach call placed", "已致電聯絡",
             "Discussed preference for green space and quiet — resident comfortable with Zhuhai."),
            (6.50, "followup", "Officer Lam",
             "Family visit assessment pending", "等待家訪評估",
             "Pending family visit assessment."),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.20, "document", "Resident",
             "Documents uploaded (4)", "已上載文件（4 份）", None),
            (1.80, "status", "Officer Lam",
             "Marked for review", "列為審核中", None),
            (3.40, "contact", "Officer Lam",
             "Outreach call placed", "已致電聯絡",
             "Walked through Zhuhai options; resident keen on a low-floor lift unit near the ferry pier."),
            (6.10, "visit", "Officer Lam",
             "Home visit completed", "完成上門探訪",
             "Confirmed mobility level and step-free requirement on site."),
            (10.40, "status", "Officer Lam",
             "Application approved", "申請已批准",
             "Approved. Move-in scheduled for 15 Aug 2026."),
            (12.00, "followup", "Officer Lam",
             "30-day wellbeing check scheduled", "已安排 30 日跟進",
             "Check-in call planned 30 days after move-in."),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.50, "document", "Resident",
             "Documents uploaded (2)", "已上載文件（2 份）", None),
            (3.00, "status", "Officer Lam",
             "Marked for review", "列為審核中", None),
            (5.20, "contact", "Officer Lam",
             "Outreach call placed", "已致電聯絡",
             "Independent senior; no care coordination required."),
            (14.10, "status", "Officer Lam",
             "Application approved", "申請已批准",
             "Approved — independent living, ancestral-home district."),
            (18.00, "followup", "Officer Lam",
             "30-day wellbeing check scheduled", "已安排 30 日跟進", None),
        ],
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
        [
            (0.00, "system", "System",
             "Application received", "申請已收到", None),
            (0.10, "document", "Resident",
             "Documents uploaded (1)", "已上載文件（1 份）",
             "HKID only — additional documents requested."),
            (1.50, "status", "Officer Lam",
             "Marked for review", "列為審核中", None),
            (3.20, "contact", "Officer Lam",
             "Outreach call placed", "已致電聯絡",
             "High care need and very frequent HK medical follow-ups; "
             "a more distant GBA city is unsuitable at this time."),
            (7.40, "status", "Officer Lam",
             "Application closed", "申請已結案",
             "High care needs plus very frequent HK follow-ups make a far city unsuitable; "
             "re-routed to a border-proximate option and community care coordinator."),
            (8.00, "followup", "Officer Lam",
             "Referred to community care coordinator", "轉介社區照護協調員",
             "Warm handover so resident is not left without a path forward."),
        ],
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
        conn.execute("DELETE FROM case_events")
        conn.execute("DELETE FROM documents")
        conn.execute("DELETE FROM applications")
        print("Cleared existing applications.")

    now = datetime.now(timezone.utc)
    inserted = 0
    for status, days_ago, name, origin, dest_id, profile, docs, note, events in SEED:
        ranked = scoring.rank_destinations(profile, destinations)
        chosen = next((d for d in ranked if d["id"] == dest_id), None)
        if not chosen:
            print(f"  skip {name}: unknown GBA dest {dest_id}", file=sys.stderr)
            continue
        # honour the applicant's first choice, then the rest of the ranking
        ordered = [chosen] + [d for d in ranked if d["id"] != dest_id]
        created_dt = now - timedelta(days=days_ago)
        created_at = created_dt.isoformat()
        # Use timestamp of the terminal status event as decided_at so the
        # avg_days_to_decision stat reflects real casework duration.
        decided_at = None
        if status in ("approved", "rejected"):
            terminal = [
                e[0] for e in events
                if e[1] == "status" and (
                    "approved" in e[3].lower()
                    or "closed" in e[3].lower()
                    or "rejected" in e[3].lower()
                )
            ]
            offset = max(terminal) if terminal else (days_ago - 1)
            decided_at = (created_dt + timedelta(days=offset)).isoformat()

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
        for offset_days, kind, author, title_en, title_tc, body in events:
            evt_at = (created_dt + timedelta(days=offset_days)).isoformat()
            meta = {}
            if kind == "status":
                if "approved" in title_en.lower():
                    meta = {"to": "approved"}
                elif "closed" in title_en.lower() or "rejected" in title_en.lower():
                    meta = {"to": "rejected"}
                elif "review" in title_en.lower():
                    meta = {"to": "under_review"}
            conn.execute(
                """INSERT INTO case_events
                   (application_id, created_at, author, kind,
                    title_en, title_tc, body, meta_json)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (app_id, evt_at, author, kind,
                 title_en, title_tc, body, json.dumps(meta, ensure_ascii=False)),
            )
        inserted += 1

    conn.commit()
    conn.close()
    print(f"Inserted {inserted} mock GBA applications.")


if __name__ == "__main__":
    main()
