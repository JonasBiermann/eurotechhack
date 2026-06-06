"""SilverLink API — serves the HK backbone data, the GBA match ranking, and the
resident→government application loop. Run from backend/:  uvicorn app:app --reload
"""
import json
import re
import secrets
from datetime import datetime, timezone

from fastapi import Body, Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import config
import db
import scoring

app = FastAPI(title="SilverLink API", version="1.0")
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
    conn = db.connect()
    if conn.execute("SELECT 1 FROM residents WHERE hkid=?", (hkid,)).fetchone():
        conn.close()
        raise HTTPException(409, "this HKID is already registered")
    cur = conn.execute(
        "INSERT INTO residents (hkid, name, created_at) VALUES (?,?,?)",
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
    name is taken from the account, not the client payload."""
    conn = db.connect()
    cur = conn.execute(
        """INSERT INTO applications
           (created_at, status, applicant_name, origin_address,
            profile_json, destinations_json, note, decided_at, resident_id)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (_now(), "submitted", resident["name"], payload.get("origin_address"),
         json.dumps(payload.get("profile", {}), ensure_ascii=False),
         json.dumps(payload.get("destinations", []), ensure_ascii=False), None, None,
         resident["id"]),
    )
    conn.commit()
    app_id = cur.lastrowid
    conn.close()
    return {"id": app_id, "status": "submitted"}


@app.post("/api/applications/{app_id}/documents")
async def upload_document(app_id: int, file: UploadFile = File(...)):
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
        """INSERT INTO documents (application_id, filename, stored_path, size, content_type, uploaded_at)
           VALUES (?,?,?,?,?,?)""",
        (app_id, file.filename, str(path), len(content), file.content_type, _now()),
    )
    conn.commit()
    doc_id = cur.lastrowid
    conn.close()
    return {"id": doc_id, "filename": file.filename, "size": len(content)}


def _app_to_dict(row, conn) -> dict:
    d = dict(row)
    d["profile"] = json.loads(d.pop("profile_json") or "{}")
    d["destinations"] = json.loads(d.pop("destinations_json") or "[]")
    docs = conn.execute(
        "SELECT id, filename, size, content_type, uploaded_at FROM documents WHERE application_id=?",
        (row["id"],),
    ).fetchall()
    d["documents"] = [dict(x) for x in docs]
    d["top_destination"] = d["destinations"][0] if d["destinations"] else None
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


@app.post("/api/applications/{app_id}/decision")
def decide(app_id: int, payload: dict = Body(...)):
    decision = payload.get("decision")
    if decision not in ("under_review", "approved", "rejected"):
        raise HTTPException(400, "decision must be under_review|approved|rejected")
    conn = db.connect()
    if not conn.execute("SELECT 1 FROM applications WHERE id=?", (app_id,)).fetchone():
        conn.close()
        raise HTTPException(404, "application not found")
    decided_at = _now() if decision in ("approved", "rejected") else None
    conn.execute("UPDATE applications SET status=?, note=?, decided_at=? WHERE id=?",
                 (decision, payload.get("note"), decided_at, app_id))
    conn.commit()
    conn.close()
    return {"id": app_id, "status": decision, "note": payload.get("note")}


@app.get("/api/applications/{app_id}/documents/{doc_id}")
def download_document(app_id: int, doc_id: int):
    conn = db.connect()
    row = conn.execute("SELECT * FROM documents WHERE id=? AND application_id=?",
                       (doc_id, app_id)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "document not found")
    return FileResponse(row["stored_path"], filename=row["filename"])
