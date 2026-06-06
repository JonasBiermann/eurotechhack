"""SilverLink API — serves the HK backbone data, the GBA match ranking, and the
resident→government application loop. Run from backend/:  uvicorn app:app --reload
"""
import json
from datetime import datetime, timezone

from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
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
DISTRICTS = _load(config.DISTRICTS_JSON, [])
db.init_db()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


@app.post("/api/destinations/rank")
def rank(profile: dict = Body(default={})):
    """Score every GBA city against the resident profile, best-first."""
    return scoring.rank_destinations(profile, DESTINATIONS)


# ------------------------------------------------------------ application loop

@app.post("/api/applications")
def create_application(payload: dict = Body(...)):
    conn = db.connect()
    cur = conn.execute(
        """INSERT INTO applications
           (created_at, status, applicant_name, origin_address,
            profile_json, destinations_json, note, decided_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (_now(), "submitted", payload.get("applicant_name"), payload.get("origin_address"),
         json.dumps(payload.get("profile", {}), ensure_ascii=False),
         json.dumps(payload.get("destinations", []), ensure_ascii=False), None, None),
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
