"""OnKui (安居) API — serves the HK backbone data, the GBA match ranking, and the
resident→government application loop. Run from backend/:  uvicorn app:app --reload
"""
import json
import re
import secrets
from datetime import datetime, timezone

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import config
import db
import scoring

app = FastAPI(title="OnKui API", version="1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)


def _load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


DESTINATIONS = _load(config.DESTINATIONS_JSON, [])
NEW_TOWNS = _load(config.NEW_TOWNS_JSON, [])
DISTRICTS = _load(config.DISTRICTS_JSON, [])
db.init_db()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------- same-city cohort (community)
# A resident may opt in to be connected with others relocating to the same GBA city.
# We do NOT run an open chat: a named HK Social Welfare Department caseworker is assigned
# per city and mediates introductions — this keeps it inside the government's remit and
# avoids moderation/liability of a social network.
_CASEWORKERS = {
    "shenzhen":  {"name_en": "Ms Chan Wai-yee",   "name_tc": "陳慧儀姑娘", "phone": "+852 2343 2101"},
    "guangzhou": {"name_en": "Mr Ho Kwok-leung",  "name_tc": "何國良先生", "phone": "+852 2343 2102"},
    "zhuhai":    {"name_en": "Ms Leung Suk-fan",   "name_tc": "梁淑芬姑娘", "phone": "+852 2343 2103"},
    "zhongshan": {"name_en": "Mr Yip Chi-keung",   "name_tc": "葉志強先生", "phone": "+852 2343 2104"},
    "foshan":    {"name_en": "Ms Tsang Mei-king",  "name_tc": "曾美琼姑娘", "phone": "+852 2343 2105"},
    "dongguan":  {"name_en": "Mr Lai Ka-ming",     "name_tc": "黎家明先生", "phone": "+852 2343 2106"},
    "jiangmen":  {"name_en": "Ms Fung Wai-han",    "name_tc": "馮慧嫻姑娘", "phone": "+852 2343 2107"},
    "huizhou":   {"name_en": "Mr So Tin-yau",      "name_tc": "蘇天佑先生", "phone": "+852 2343 2108"},
}
_DEFAULT_CASEWORKER = {"name_en": "GBA Resettlement Liaison Team", "name_tc": "大灣區安居聯絡組",
                       "phone": "+852 2343 2100"}
_COHORT_WINDOW_DAYS = 120  # "moving around the same time as you"


def _caseworker_for(city_id: str | None) -> dict:
    cw = dict(_CASEWORKERS.get(city_id or "", _DEFAULT_CASEWORKER))
    cw["office_en"] = "Social Welfare Department · Cross-boundary Elderly Care Team"
    cw["office_tc"] = "社會福利署 · 跨境長者照顧組"
    return cw


def _dest_meta(city_id: str | None) -> dict:
    for d in DESTINATIONS:
        if d.get("id") == city_id:
            return d
    return {}


def _top_city(destinations_json: str | None) -> dict | None:
    """Return the chosen (first-ranked) GBA city dict for an application, or None."""
    try:
        dests = json.loads(destinations_json or "[]")
    except (TypeError, ValueError):
        return None
    return dests[0] if dests else None


def _mask_name(name: str | None) -> str:
    """Privacy: 'Mrs Lee Siu-mei' -> 'Mrs Lee'. Keeps title + surname only."""
    parts = (name or "").split()
    if len(parts) >= 2 and parts[0] in ("Mr", "Mrs", "Ms", "Miss", "Dr"):
        return f"{parts[0]} {parts[1]}"
    return parts[0] if parts else "A resident"


# ------------------------------------------------------------- auth (HKID-only)

_HKID_RE = re.compile(r"^[A-Z]{1,2}[0-9]{6}(\([0-9A]\))?$")


def _normalize_hkid(raw: str | None) -> str:
    """Upper-case, strip whitespace, light-validate a HK identity card number."""
    hkid = (raw or "").strip().upper().replace(" ", "")
    if not _HKID_RE.match(hkid):
        raise HTTPException(400, "invalid HKID format")
    return hkid


def _issue_session(conn, resident_id: int) -> str:
    token = secrets.token_hex(24)
    conn.execute(
        "INSERT INTO sessions (token, resident_id, created_at) VALUES (?,?,?)",
        (token, resident_id, _now()),
    )
    return token


def current_resident(authorization: str | None = Header(None)) -> dict:
    """Resolve `Authorization: Bearer <token>` to a resident row, or 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    conn = db.connect()
    row = conn.execute(
        """SELECT r.* FROM sessions s JOIN residents r ON r.id = s.resident_id
           WHERE s.token = ?""",
        (token,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(401, "invalid or expired session")
    return dict(row)


@app.post("/api/auth/register")
def register(payload: dict = Body(...)):
    hkid = _normalize_hkid(payload.get("hkid"))
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    if not payload.get("ehealth_consent"):
        raise HTTPException(400, "E-Health System consent is required to register")
    conn = db.connect()
    if conn.execute("SELECT 1 FROM residents WHERE hkid=?", (hkid,)).fetchone():
        conn.close()
        raise HTTPException(409, "this HKID is already registered")
    cur = conn.execute(
        "INSERT INTO residents (hkid, name, created_at, ehealth_consent) VALUES (?,?,?,1)",
        (hkid, name, _now()),
    )
    resident_id = cur.lastrowid
    token = _issue_session(conn, resident_id)
    conn.commit()
    conn.close()
    return {"token": token, "resident": {"id": resident_id, "hkid": hkid, "name": name}}


@app.post("/api/auth/login")
def login(payload: dict = Body(...)):
    hkid = _normalize_hkid(payload.get("hkid"))
    conn = db.connect()
    row = conn.execute("SELECT * FROM residents WHERE hkid=?", (hkid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "no account for this HKID — please register")
    token = _issue_session(conn, row["id"])
    conn.commit()
    conn.close()
    return {"token": token, "resident": {"id": row["id"], "hkid": row["hkid"], "name": row["name"]}}


@app.get("/api/auth/me")
def me(resident: dict = Depends(current_resident)):
    return {"id": resident["id"], "hkid": resident["hkid"], "name": resident["name"]}


@app.post("/api/auth/logout")
def logout(authorization: str | None = Header(None), resident: dict = Depends(current_resident)):
    token = authorization.split(" ", 1)[1].strip()
    conn = db.connect()
    conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ------------------------------------------------------------- HK backbone data

@app.get("/api/health")
def health():
    return {"status": "ok", "districts": len(DISTRICTS), "destinations": len(DESTINATIONS)}


@app.get("/api/districts")
def districts():
    return DISTRICTS


_BUILDINGS_FC = None


def _buildings_fc():
    global _BUILDINGS_FC
    if _BUILDINGS_FC is None:
        _BUILDINGS_FC = _load(config.BUILDINGS_GEOJSON, {"type": "FeatureCollection", "features": []})
    return _BUILDINGS_FC


@app.get("/api/buildings")
def buildings(bbox: str | None = Query(None, description="minLng,minLat,maxLng,maxLat")):
    """LandsD footprints (with joined age + no_lift). Whole set, or filtered by bbox
    (used by the resident view to show footprints around a searched building)."""
    if not config.BUILDINGS_GEOJSON.exists():
        raise HTTPException(404, "buildings not ingested — run ingest.py")
    if not bbox:
        return FileResponse(config.BUILDINGS_GEOJSON, media_type="application/geo+json")
    try:
        min_lng, min_lat, max_lng, max_lat = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be minLng,minLat,maxLng,maxLat")

    def first_pt(geom):
        c = geom["coordinates"]
        while isinstance(c[0], list):
            c = c[0]
        return c  # [lng, lat]

    feats = []
    for f in _buildings_fc()["features"]:
        lng, lat = first_pt(f["geometry"])
        if min_lng <= lng <= max_lng and min_lat <= lat <= max_lat:
            feats.append(f)
    return {"type": "FeatureCollection", "features": feats}


@app.get("/api/heatmap")
def heatmap(metric: str = Query("age")):
    if metric not in config.HEATMAP_METRICS:
        raise HTTPException(400, f"metric must be one of {config.HEATMAP_METRICS}")
    path = config.HEATMAP_FILES[metric]
    if not path.exists():
        raise HTTPException(404, "heatmap not ingested — run ingest.py")
    return FileResponse(path, media_type="application/geo+json")


@app.get("/api/buildings/search")
def search(q: str = Query(..., min_length=1), limit: int = 20):
    """Find a resident's current HK building by address (bilingual)."""
    like = f"%{q}%"
    conn = db.connect()
    rows = conn.execute(
        """SELECT * FROM bd_records
           WHERE address_en LIKE ? OR address_tc LIKE ?
           ORDER BY (age_years IS NULL), age_years DESC LIMIT ?""",
        (like, like, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/buildings/{bid}")
def building_detail(bid: int):
    conn = db.connect()
    row = conn.execute("SELECT * FROM bd_records WHERE id=?", (bid,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "building not found")
    return dict(row)


# ------------------------------------------------------------- GBA destinations

@app.get("/api/destinations")
def destinations():
    return DESTINATIONS


@app.get("/api/voucher-hospitals")
def voucher_hospitals():
    """The 21 EHCV-designated GBA service points (hardcoded, gov-sourced)."""
    return _load(config.VOUCHER_HOSPITALS_JSON, {"institutions": []})


@app.post("/api/destinations/rank")
def rank(profile: dict = Body(default={}), persona: str | None = Query(None)):
    """Score every GBA city against the resident profile, best-first.

    Each option carries match.subscores, the demo projections (net savings + runway,
    time-to-care, return burden, projected wellbeing), a transparent benefits ledger,
    warnings and per-number provenance. ``persona`` overrides the auto-selected weight
    profile (balanced | frugal_healthy | chronic_hk_anchored | frail_residential |
    family_oriented); it may also be passed as a "persona" key in the profile body.
    """
    persona = persona or profile.get("persona")
    return scoring.rank_destinations(profile, DESTINATIONS, persona=persona)


# --------------------------------------- HK new-town senior-housing options (gov)

@app.get("/api/new_towns")
def new_towns():
    """HK outskirt new towns where senior-friendly housing is being built
    (Northern Metropolis + Lantau). Informational — resident applications
    reference these by ID when residents pick a destination themselves.
    """
    return NEW_TOWNS


# ------------------------------------------------------------ application loop

@app.post("/api/applications")
def create_application(payload: dict = Body(...), resident: dict = Depends(current_resident)):
    """Create an application owned by the authenticated resident. The applicant
    name is taken from the account, not the client payload. One per resident —
    a relocation happens only once."""
    conn = db.connect()
    # One *live* application per resident — a rejected application frees the slot so
    # the resident can start over.
    if conn.execute(
        "SELECT 1 FROM applications WHERE resident_id=? AND status != 'rejected'",
        (resident["id"],),
    ).fetchone():
        conn.close()
        raise HTTPException(409, "you already have an application")
    cur = conn.execute(
        """INSERT INTO applications
           (created_at, status, applicant_name, origin_address,
            profile_json, destinations_json, note, decided_at, resident_id, cohort_optin)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (_now(), "started", resident["name"], payload.get("origin_address"),
         json.dumps(payload.get("profile", {}), ensure_ascii=False),
         json.dumps(payload.get("destinations", []), ensure_ascii=False), None, None,
         resident["id"], 1 if payload.get("cohort_optin") else 0),
    )
    app_id = cur.lastrowid
    _log_event(
        conn, app_id, kind="system", author="System",
        title_en="Application received",
        title_tc="申請已收到",
        body=f"Submitted by {resident['name']}.",
        meta={"to": "submitted"},
    )
    conn.commit()
    conn.close()
    return {"id": app_id, "status": "started"}


@app.post("/api/applications/{app_id}/submit")
def submit_application(app_id: int, resident: dict = Depends(current_resident)):
    """Resident confirms the truth declaration and submits a started application.
    Only the owner may submit, and only from the 'started' state. Once submitted,
    the application appears in the government officer queue."""
    conn = db.connect()
    row = conn.execute(
        "SELECT status, resident_id FROM applications WHERE id=?", (app_id,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "application not found")
    if row["resident_id"] != resident["id"]:
        conn.close()
        raise HTTPException(403, "not your application")
    if row["status"] != "started":
        conn.close()
        raise HTTPException(409, "application has already been submitted")
    conn.execute(
        "UPDATE applications SET status='submitted', declaration_at=? WHERE id=?",
        (_now(), app_id),
    )
    conn.commit()
    conn.close()
    return {"id": app_id, "status": "submitted"}


@app.delete("/api/applications/{app_id}")
def delete_application(app_id: int, resident: dict = Depends(current_resident)):
    """Resident deletes their own application so they can start a new one."""
    conn = db.connect()
    row = conn.execute("SELECT resident_id FROM applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "application not found")
    if row["resident_id"] != resident["id"]:
        conn.close()
        raise HTTPException(403, "not your application")
    conn.execute("DELETE FROM case_events WHERE application_id=?", (app_id,))
    conn.execute("DELETE FROM documents WHERE application_id=?", (app_id,))
    conn.execute("DELETE FROM applications WHERE id=?", (app_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------------------------------------------- same-city cohort (community landing)

@app.post("/api/applications/{app_id}/cohort")
def set_cohort_optin(app_id: int, payload: dict = Body(...),
                     resident: dict = Depends(current_resident)):
    """Resident opts in/out of being connected with others moving to the same city."""
    optin = 1 if payload.get("opt_in") else 0
    conn = db.connect()
    row = conn.execute("SELECT resident_id FROM applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "application not found")
    if row["resident_id"] != resident["id"]:
        conn.close()
        raise HTTPException(403, "not your application")
    conn.execute("UPDATE applications SET cohort_optin=? WHERE id=?", (optin, app_id))
    conn.commit()
    conn.close()
    return {"id": app_id, "cohort_optin": bool(optin)}


def _cohort_members(conn, city_id: str) -> list[dict]:
    """All non-rejected applications whose chosen city is ``city_id`` and who opted in."""
    rows = conn.execute(
        """SELECT id, applicant_name, status, created_at, cohort_optin, destinations_json
             FROM applications WHERE status != 'rejected' AND cohort_optin = 1"""
    ).fetchall()
    out = []
    for r in rows:
        top = _top_city(r["destinations_json"])
        if top and top.get("id") == city_id:
            out.append(dict(r))
    return out


@app.get("/api/cohort/mine")
def my_cohort(resident: dict = Depends(current_resident)):
    """The same-city cohort for the authenticated resident's live application.

    Always returns the cohort *around* the resident's chosen city (so the opt-in
    toggle can say "5 others are going to Zhuhai"); ``opted_in`` reflects whether
    this resident has joined."""
    conn = db.connect()
    mine = conn.execute(
        """SELECT id, status, created_at, cohort_optin, destinations_json
             FROM applications WHERE resident_id=? AND status != 'rejected'
             ORDER BY id DESC LIMIT 1""",
        (resident["id"],),
    ).fetchone()
    if not mine:
        conn.close()
        return {"has_destination": False}
    top = _top_city(mine["destinations_json"])
    if not top:
        conn.close()
        return {"has_destination": False}
    city_id = top.get("id")
    opted_in = bool(mine["cohort_optin"])

    members = _cohort_members(conn, city_id)
    conn.close()

    peers = [m for m in members if m["id"] != mine["id"]]
    moved = sum(1 for m in members if m["status"] == "moved")
    approved = sum(1 for m in members if m["status"] in ("approved", "moved"))

    now = datetime.now(timezone.utc)
    in_window = 0
    for m in members:
        if m["id"] == mine["id"]:
            continue
        try:
            c = datetime.fromisoformat((m["created_at"] or "").replace("Z", "+00:00"))
            if abs((now - c).days) <= _COHORT_WINDOW_DAYS:
                in_window += 1
        except (ValueError, AttributeError):
            pass

    meta = _dest_meta(city_id)
    return {
        "has_destination": True,
        "opted_in": opted_in,
        "application_id": mine["id"],
        "city_id": city_id,
        "name_en": top.get("name_en"), "name_tc": top.get("name_tc"),
        "members": len(members),            # opted-in cohort size (incl. self if opted)
        "others": len(peers),               # everyone except this resident
        "in_window": in_window,             # peers moving around the same time
        "moved": moved,                     # peers already settled
        "approved": approved,               # peers approved or settled
        "caseworker": _caseworker_for(city_id),
        "control_point": meta.get("control_point"),
        "border_travel_hr": meta.get("border_travel_hr"),
        "ehcv_institution": meta.get("ehcv_institution"),
        "peers": [
            {"name": _mask_name(p["applicant_name"]), "status": p["status"]}
            for p in peers
        ],
    }


@app.get("/api/cohorts")
def list_cohorts():
    """Government view: every same-city cohort with member/settled counts + caseworker."""
    conn = db.connect()
    rows = conn.execute(
        """SELECT applicant_name, status, destinations_json
             FROM applications WHERE status != 'rejected' AND cohort_optin = 1"""
    ).fetchall()
    conn.close()
    by_city: dict[str, dict] = {}
    for r in rows:
        top = _top_city(r["destinations_json"])
        if not top:
            continue
        cid = top.get("id")
        c = by_city.setdefault(cid, {
            "id": cid, "name_en": top.get("name_en"), "name_tc": top.get("name_tc"),
            "members": 0, "moved": 0, "approved": 0, "names": [],
        })
        c["members"] += 1
        if r["status"] == "moved":
            c["moved"] += 1
        if r["status"] in ("approved", "moved"):
            c["approved"] += 1
        c["names"].append(_mask_name(r["applicant_name"]))
    out = []
    for cid, c in by_city.items():
        c["caseworker"] = _caseworker_for(cid)
        out.append(c)
    out.sort(key=lambda x: -x["members"])
    return out


# ---------------------------------------------- permits & allowances (self-service)

_PERMIT_KINDS = ("home_return_permit", "guangdong_allowance")
_ALLOWANCE_SCHEMES = ("oaa", "oala")


@app.post("/api/permits")
def create_permit(payload: dict = Body(...), resident: dict = Depends(current_resident)):
    """Persist a resident's self-service permit / allowance application.
    Resident-only — these are not surfaced in the government officer console."""
    kind = payload.get("kind")
    if kind not in _PERMIT_KINDS:
        raise HTTPException(400, f"kind must be one of {_PERMIT_KINDS}")
    scheme = payload.get("scheme")
    if kind == "guangdong_allowance":
        if scheme not in _ALLOWANCE_SCHEMES:
            raise HTTPException(400, f"scheme must be one of {_ALLOWANCE_SCHEMES}")
    else:
        scheme = None
    conn = db.connect()
    cur = conn.execute(
        """INSERT INTO permit_applications
           (resident_id, kind, scheme, status, details_json, created_at)
           VALUES (?,?,?,?,?,?)""",
        (resident["id"], kind, scheme, "submitted",
         json.dumps(payload.get("details", {}), ensure_ascii=False), _now()),
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return {"id": pid, "kind": kind, "scheme": scheme, "status": "submitted"}


@app.get("/api/permits/mine")
def my_permits(resident: dict = Depends(current_resident)):
    conn = db.connect()
    rows = conn.execute(
        "SELECT * FROM permit_applications WHERE resident_id=? ORDER BY id DESC",
        (resident["id"],),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["details"] = json.loads(d.pop("details_json") or "{}")
        out.append(d)
    return out


@app.post("/api/applications/{app_id}/documents")
async def upload_document(app_id: int, file: UploadFile = File(...),
                          doc_type: str = Form("certificate")):
    if doc_type not in ("certificate", "proof_of_move"):
        raise HTTPException(400, "doc_type must be certificate|proof_of_move")
    conn = db.connect()
    if not conn.execute("SELECT 1 FROM applications WHERE id=?", (app_id,)).fetchone():
        conn.close()
        raise HTTPException(404, "application not found")
    dest_dir = config.UPLOAD_DIR / str(app_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    path = dest_dir / file.filename
    path.write_bytes(content)
    cur = conn.execute(
        """INSERT INTO documents (application_id, filename, stored_path, size, content_type, uploaded_at, doc_type)
           VALUES (?,?,?,?,?,?,?)""",
        (app_id, file.filename, str(path), len(content), file.content_type, _now(), doc_type),
    )
    doc_id = cur.lastrowid
    is_proof = doc_type == "proof_of_move"
    _log_event(
        conn, app_id, kind="document", author="Resident",
        title_en=("Proof of move uploaded: " if is_proof else "Document uploaded: ") + file.filename,
        title_tc=("已上載遷居證明：" if is_proof else "已上載文件：") + file.filename,
        meta={"document_id": doc_id, "filename": file.filename, "doc_type": doc_type},
    )
    conn.commit()
    conn.close()
    return {"id": doc_id, "filename": file.filename, "size": len(content), "doc_type": doc_type}


def _events_for(conn, app_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT id, created_at, author, kind, title_en, title_tc, body, meta_json
             FROM case_events WHERE application_id=? ORDER BY created_at ASC, id ASC""",
        (app_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["meta"] = json.loads(d.pop("meta_json") or "{}")
        out.append(d)
    return out


def _log_event(conn, app_id: int, kind: str, author: str,
               title_en: str, title_tc: str, body: str | None = None,
               meta: dict | None = None, created_at: str | None = None) -> int:
    cur = conn.execute(
        """INSERT INTO case_events
           (application_id, created_at, author, kind, title_en, title_tc, body, meta_json)
           VALUES (?,?,?,?,?,?,?,?)""",
        (app_id, created_at or _now(), author, kind, title_en, title_tc, body,
         json.dumps(meta or {}, ensure_ascii=False)),
    )
    return cur.lastrowid


def _app_to_dict(row, conn) -> dict:
    d = dict(row)
    d["profile"] = json.loads(d.pop("profile_json") or "{}")
    d["destinations"] = json.loads(d.pop("destinations_json") or "[]")
    docs = conn.execute(
        "SELECT id, filename, size, content_type, uploaded_at, doc_type FROM documents WHERE application_id=?",
        (row["id"],),
    ).fetchall()
    d["documents"] = [dict(x) for x in docs]
    d["events"] = _events_for(conn, row["id"])
    d["top_destination"] = d["destinations"][0] if d["destinations"] else None
    d["cohort_optin"] = bool(d.get("cohort_optin"))
    # Resident has submitted proof of move and is awaiting officer confirmation.
    d["proof_pending"] = (
        d.get("status") == "approved"
        and any(x.get("doc_type") == "proof_of_move" for x in d["documents"])
    )
    return d


@app.get("/api/applications")
def list_applications():
    conn = db.connect()
    rows = conn.execute("SELECT * FROM applications ORDER BY id DESC").fetchall()
    out = [_app_to_dict(r, conn) for r in rows]
    conn.close()
    return out


@app.get("/api/applications/mine")
def my_applications(resident: dict = Depends(current_resident)):
    conn = db.connect()
    rows = conn.execute(
        "SELECT * FROM applications WHERE resident_id=? ORDER BY id DESC", (resident["id"],)
    ).fetchall()
    out = [_app_to_dict(r, conn) for r in rows]
    conn.close()
    return out


@app.get("/api/applications/{app_id}")
def get_application(app_id: int):
    conn = db.connect()
    row = conn.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "application not found")
    out = _app_to_dict(row, conn)
    conn.close()
    return out


_DECISION_TITLES = {
    "under_review": ("Marked for review", "列為審核中"),
    "approved":     ("Application approved", "申請已批准"),
    "rejected":     ("Application closed",  "申請已結案"),
    "moved":        ("Move confirmed — resident settled", "已確認遷居 — 居民已安頓"),
}


@app.post("/api/applications/{app_id}/decision")
def decide(app_id: int, payload: dict = Body(...)):
    decision = payload.get("decision")
    if decision not in ("under_review", "approved", "rejected", "moved"):
        raise HTTPException(400, "decision must be under_review|approved|rejected|moved")
    conn = db.connect()
    prev = conn.execute("SELECT status FROM applications WHERE id=?", (app_id,)).fetchone()
    if not prev:
        conn.close()
        raise HTTPException(404, "application not found")
    # A move can only be confirmed for an already-approved application.
    if decision == "moved" and prev["status"] != "approved":
        conn.close()
        raise HTTPException(409, "only an approved application can be confirmed as moved")
    officer = payload.get("officer") or "Officer Lam"
    note = payload.get("note")
    if decision == "moved":
        # Keep decided_at (the approval timestamp); record the settle date separately.
        conn.execute("UPDATE applications SET status=?, moved_at=? WHERE id=?",
                     (decision, _now(), app_id))
    else:
        decided_at = _now() if decision in ("approved", "rejected") else None
        conn.execute("UPDATE applications SET status=?, note=?, decided_at=? WHERE id=?",
                     (decision, note, decided_at, app_id))
    title_en, title_tc = _DECISION_TITLES[decision]
    _log_event(
        conn, app_id, kind="status", author=officer,
        title_en=title_en, title_tc=title_tc, body=note,
        meta={"from": prev["status"], "to": decision},
    )
    conn.commit()
    conn.close()
    return {"id": app_id, "status": decision, "note": note}


@app.get("/api/applications/{app_id}/events")
def list_events(app_id: int):
    conn = db.connect()
    if not conn.execute("SELECT 1 FROM applications WHERE id=?", (app_id,)).fetchone():
        conn.close()
        raise HTTPException(404, "application not found")
    out = _events_for(conn, app_id)
    conn.close()
    return out


@app.post("/api/applications/{app_id}/events")
def add_event(app_id: int, payload: dict = Body(...)):
    """Add a free-form case-file event (caseworker note, contact, home visit,
    follow-up scheduled). Kind defaults to 'note'."""
    conn = db.connect()
    if not conn.execute("SELECT 1 FROM applications WHERE id=?", (app_id,)).fetchone():
        conn.close()
        raise HTTPException(404, "application not found")
    kind = payload.get("kind") or "note"
    if kind not in ("note", "contact", "visit", "followup", "document", "system", "status"):
        raise HTTPException(400, "unknown event kind")
    body = (payload.get("body") or "").strip()
    title_en = (payload.get("title_en") or "").strip()
    title_tc = (payload.get("title_tc") or "").strip()
    if not (body or title_en or title_tc):
        raise HTTPException(400, "event needs a title or body")
    if not title_en and not title_tc:
        # No explicit title: derive one from kind so the timeline always has a heading.
        defaults = {
            "note":     ("Case note",          "個案備註"),
            "contact":  ("Contacted resident", "已聯絡居民"),
            "visit":    ("Home visit",         "上門探訪"),
            "followup": ("Follow-up scheduled", "已安排跟進"),
        }
        title_en, title_tc = defaults.get(kind, ("Update", "更新"))
    eid = _log_event(
        conn, app_id, kind=kind, author=payload.get("author") or "Officer Lam",
        title_en=title_en or title_tc, title_tc=title_tc or title_en,
        body=body or None, meta=payload.get("meta") or {},
    )
    conn.commit()
    out = conn.execute(
        """SELECT id, created_at, author, kind, title_en, title_tc, body, meta_json
             FROM case_events WHERE id=?""", (eid,),
    ).fetchone()
    conn.close()
    d = dict(out)
    d["meta"] = json.loads(d.pop("meta_json") or "{}")
    return d


@app.get("/api/stats")
def get_stats():
    """Aggregated stats for the government analytics dashboard."""
    conn = db.connect()

    # ---- by-status counts ----
    status_rows = conn.execute(
        "SELECT status, COUNT(*) as n FROM applications GROUP BY status"
    ).fetchall()
    by_status: dict = {r["status"]: r["n"] for r in status_rows}
    total = sum(by_status.values())
    submitted   = by_status.get("submitted", 0)
    under_review = by_status.get("under_review", 0)
    approved    = by_status.get("approved", 0)
    rejected    = by_status.get("rejected", 0)
    moved       = by_status.get("moved", 0)
    # A 'moved' application was approved earlier in its lifecycle, so it still
    # counts as an approval (and a freed unit) for these aggregates.
    approved_total = approved + moved
    decided     = approved_total + rejected

    # ---- scan all applications once for scores / profiles ----
    app_rows = conn.execute(
        "SELECT destinations_json, profile_json, created_at, decided_at, status FROM applications"
    ).fetchall()

    scores: list = []
    decision_days: list = []
    dest_counts: dict = {}
    dest_moved_counts: dict = {}
    dest_score_sums: dict = {}
    care_counts: dict = {0: 0, 1: 0, 2: 0, 3: 0}
    step_free_count = 0
    incomes: list = []

    for row in app_rows:
        dests   = json.loads(row["destinations_json"] or "[]")
        profile = json.loads(row["profile_json"]      or "{}")

        if dests:
            top   = dests[0]
            match = top.get("match") or {}
            if isinstance(match, dict) and "score" in match:
                s = float(match["score"])
                scores.append(s)
                did = top.get("id")
                if did:
                    dest_counts[did] = dest_counts.get(did, 0) + 1
                    dest_score_sums.setdefault(did, []).append(s)
                    if row["status"] == "moved":
                        dest_moved_counts[did] = dest_moved_counts.get(did, 0) + 1

        if row["decided_at"] and row["created_at"]:
            try:
                c = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                d = datetime.fromisoformat(row["decided_at"].replace("Z", "+00:00"))
                decision_days.append((d - c).total_seconds() / 86_400)
            except Exception:
                pass

        level = int(profile.get("care_level") or 0)
        care_counts[level] = care_counts.get(level, 0) + 1
        if profile.get("needs_step_free"):
            step_free_count += 1
        if profile.get("monthly_income"):
            incomes.append(float(profile["monthly_income"]))

    # ---- destination breakdown ----
    dest_meta = {d["id"]: (d["name_en"], d["name_tc"]) for d in DESTINATIONS}
    by_destination = sorted(
        [
            {
                "id": did,
                "name_en": dest_meta.get(did, (did, did))[0],
                "name_tc": dest_meta.get(did, (did, did))[1],
                "count": count,
                "moved": dest_moved_counts.get(did, 0),
                "avg_score": round(
                    sum(dest_score_sums.get(did, [0]))
                    / max(1, len(dest_score_sums.get(did, []))), 0
                ),
            }
            for did, count in dest_counts.items()
        ],
        key=lambda x: (-x["count"], -x["avg_score"])
    )

    # ---- monthly volume (last 6 months, ascending) ----
    month_rows = conn.execute(
        """SELECT strftime('%Y-%m', created_at) as m, COUNT(*) as n
           FROM applications GROUP BY m ORDER BY m DESC LIMIT 6"""
    ).fetchall()
    by_month = [{"month": r["m"], "count": r["n"]} for r in reversed(month_rows)]

    # ---- case events by kind ----
    event_rows = conn.execute(
        "SELECT kind, COUNT(*) as n FROM case_events GROUP BY kind"
    ).fetchall()
    events_by_kind = {r["kind"]: r["n"] for r in event_rows}

    conn.close()

    return {
        "total": total,
        "by_status": {
            "submitted":   submitted,
            "under_review": under_review,
            "approved":    approved,
            "rejected":    rejected,
            "moved":       moved,
        },
        "settled_total": moved,
        "units_freed":   approved_total,
        "pending":       submitted + under_review,
        "approval_rate": round(approved_total / decided * 100, 1) if decided > 0 else None,
        "avg_match_score": round(sum(scores) / len(scores), 1) if scores else None,
        "avg_days_to_decision": round(sum(decision_days) / len(decision_days), 1) if decision_days else None,
        "by_destination": by_destination,
        "by_care_level":  [{"level": i, "count": care_counts.get(i, 0)} for i in range(4)],
        "step_free_count": step_free_count,
        "step_free_pct": round(step_free_count / total * 100, 1) if total > 0 else 0,
        "avg_income": round(sum(incomes) / len(incomes)) if incomes else None,
        "by_month": by_month,
        "total_events": sum(events_by_kind.values()),
        "events_by_kind": events_by_kind,
    }


@app.get("/api/applications/{app_id}/documents/{doc_id}")
def download_document(app_id: int, doc_id: int):
    conn = db.connect()
    row = conn.execute("SELECT * FROM documents WHERE id=? AND application_id=?",
                       (doc_id, app_id)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "document not found")
    return FileResponse(row["stored_path"], filename=row["filename"])
