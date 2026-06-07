# OnKui · 安居

Voluntary, opt-in **elderly relocation platform** for Hong Kong, matched on real city data.
A resident applies to relocate to a Greater Bay Area city; a government officer approves it.

Built on two HK open datasets as the **origin backbone**:

| Dataset | Use |
|---|---|
| **BD – Building information & age records** (`bd_rcd_1631167534872_19764`) | building **age** (occupation-permit date), address, usage |
| **LandsD – OpenMap Building** (`landsd_rcd_1637211194312_35158`) | building **footprint + height** |

The two are joined (point-in-polygon, ~99.9% hit rate) to derive the **"old + low-rise → likely no
lift / not step-free"** signal that drives the government heatmap and the resident's *push* factor.
GBA destination figures are **seeded/illustrative** (the HK datasets don't cover the mainland).

## Two separate sites (one shared backend)
- **Resident** (`frontend-resident/`, :5173) — accessible large-type 4-step wizard: profile & finances
  → **rank GBA cities by Match Score** → upload documents → submit & track status.
- **Government** (`frontend-government/`, :5174) — a care-pressure **heatmap** (3 toggle metrics:
  ageing housing / building density / likely no-lift) over Sham Shui Po, Kwun Tong, Wan Chai, plus an
  **applications approval queue**.

They are fully independent apps (own deps/build), connected only through the FastAPI backend.

EN ⇄ **繁體中文** toggle (UI strings *and* data fields). Desktop, glassmorphism, MapLibre GL.

## Run it

```bash
# 1. Backend (Python 3.12)
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
PYTHONPATH=backend .venv/bin/python backend/seed_gba.py          # seed GBA destination cities
PYTHONPATH=backend .venv/bin/python backend/seed_new_towns.py    # seed HK new-town units
PYTHONPATH=backend .venv/bin/python backend/seed_applications.py # seed the approval queue
PYTHONPATH=backend .venv/bin/python backend/ingest.py            # fetch + build HK data (network; cached after)
PYTHONPATH=backend .venv/bin/uvicorn app:app --port 8000 --reload --reload-dir backend

# 2. Frontend — two completely separate apps (Node 18+), each in its own terminal
npm install --prefix frontend-resident   && npm run dev --prefix frontend-resident     # → http://localhost:5173
npm install --prefix frontend-government && npm run dev --prefix frontend-government   # → http://localhost:5174
# both proxy /api -> :8000

# tests
PYTHONPATH=backend .venv/bin/pytest backend/tests
```

`backend/ingest.py` caches raw WFS responses under `backend/data/raw/`; re-runs are offline. Add
`--refresh` to re-fetch.

## Presentation mode

`presentation/` is a single static page that demos both sites end-to-end: it embeds the **Resident**
site, plays a **transition video**, then embeds the **Government** site — navigated with the
keyboard arrow keys (`→` / `←`) only. With the backend and both frontends running, serve it with any
static file server, e.g.:

```bash
python3 -m http.server 8080 --directory presentation   # → http://localhost:8080
```

## Layout
```
backend/             config · db · ingest (WFS+join) · seed_* · scoring (model swap-point) · app (FastAPI)
frontend-resident/   src/{App, views/ResidentWizard, map, i18n, components, api, styles}   (:5173)
frontend-government/ src/{App, views/GovernmentView,  map, i18n, components, api, styles}   (:5174)
presentation/        static demo shell (resident → transition video → government), arrow-key nav
docs/                project notes — PIPELINE, business_video
HONESTY.md           scope & honesty disclosure (what's real vs. seeded/illustrative)
```
Each frontend carries its own copy of the common code (map/i18n/api/components/styles) — no shared module.

## The Match Score
`backend/scoring.py :: compute_match_score(profile, dest)` — a transparent weighted sum over
**affordability · accessibility · care_access · lifestyle_fit · proximity**, returning a 0–100 score
with a per-factor breakdown. It is the single **swap-point for a future ML model**: keep the
signature, replace the body — no API or UI change needed.

> Scope: this implements docs/PIPELINE.txt Stage 1 (intelligence/heatmap) + Stage 3 (opt-in application
> loop). Stage 2 graph-matching and Stage 4 simulation are out of scope. No real auth/document
> processing; GBA destination data is illustrative seed data.
