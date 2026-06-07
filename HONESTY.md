# HONESTY.md

> Mandatory disclosure for the hackathon. This file lives at the root of your repository. Judges cross-check it against your code and your technical video.
>
> **The deal:** disclosed shortcuts are **not** penalized — that is the entire point of this file. Hidden ones are. Undisclosed pre-built code is heavily penalized, each undisclosed mock carries a small penalty, and a faked demo is heavily penalized. Telling the truth here costs you nothing.

---

## 1. Team — who did what
Judges compare this against `git shortlog -sn`, so keep it honest.

`git shortlog -sn` for this repo:

```
    17  go57ras
    9  Sivaram Yadav Nalliboyana
    2  Matteo
    1  Ediz Perez
    1  sheyxps
```

| Member | GitHub handle | Main contributions |
|---|---|---|
| Jonas Biermann | `go57ras` / `JonasBiermann` (repo owner) | Backend (FastAPI app, ingest/WFS join, scoring/projections/benefits, DB), data seeding, resident + government frontends, glass/red design |
| Sivaram Yadav Nalliboyana | `nsivaramdav` (commit name) | Frontend work, government console / stats, integration |
| Matteo | `nyce0979` / `sheyxps` (commit name) | Frontend / Presentation/ design contributions |
| Ediz | `Ediz Perez` (commit name) | Frontend / Backend (FastAPI app), data seeding |

---

## 2. What is fully working
Features that run end-to-end on the live app, with real data and real logic.

- **HK building-data ingest (real open data).** `backend/ingest.py` calls the CSDI OGC WFS endpoints live — **LandsD OpenMap "Building"** (footprint polygons + heights) and **BD "Building information and age records"** (address + occupation-permit date). It paginates per district bbox, caches raw responses to `backend/data/raw/`, then does a real point-in-polygon spatial join (Shapely `STRtree`, with nearest-snap fallback) to attach building age + storey estimate to each footprint. Input: 3 seeded districts (Sham Shui Po, Kwun Tong, Wan Chai). Output: `bd_records` rows in SQLite, `buildings.geojson`, three heatmap GeoJSONs, `districts.json`.
- **Care-pressure heatmap (government console).** `GET /api/heatmap?metric=age|density|nolift` serves GeoJSON grids (~330 m cells) computed from the ingested data, rendered on MapLibre GL. The "likely no-lift / not step-free" signal is derived (old + low-rise heuristic — see §3).
- **Bilingual building address search.** `GET /api/buildings/search?q=` does a real `LIKE` query over real BD records (EN + 繁中 address fields) in SQLite.
- **Match Score / GBA destination ranking.** `backend/scoring.py :: rank_destinations` is a real, transparent, deterministic weighted-sum over 4 dimensions (financial, connectivity, care, livability) with per-persona weights (`weights.py`), per-factor breakdown, a benefits ledger, projections and per-number provenance badges. It is **not** ML and **not** an LLM — the README and code state this openly and frame it as the swap-point for a future model.
- **HK specialist-outpatient (SOP) waiting times.** `backend/data/hk_sop_waits.json` is a real cached snapshot of the HA open-data SOP waiting-time feed (per-specialty routine waits in weeks, verified 2026-06-07). Used as the real "time-to-care in HK" side of the projection.
- **Resident auth + session.** `POST /api/auth/register` / `login` / `me` / `logout` — HKID-based accounts, opaque session tokens (`secrets.token_hex`), persisted in SQLite, restored from `localStorage`. Real (but see §3 for what it does *not* verify).
- **Application loop (resident → government), end-to-end.** Create application, submit with truth declaration, upload documents (real files written to `backend/data/uploads/<app_id>/`), officer decision (`under_review`/`approved`/`rejected`/`moved`), a persisted bilingual case-event timeline, and delete-to-restart. All in SQLite.
- **Permits / allowances self-service.** `POST /api/permits` persists Home Return Permit / Guangdong allowance applications.
- **Government statistics dashboard.** `GET /api/stats` returns real aggregations computed live from the applications/events in the DB (by status, by destination, by care level, approval rate, avg match score, monthly volume, etc.).
- **EN ⇄ 繁體中文 toggle** across UI strings and data fields, both frontends.
- **Voice assistant (real TTS).** `useElevenLabs.ts` makes a real call to the ElevenLabs text-to-speech API and plays the audio. See §3 for what it is and is not.

---

## 3. What is mocked, stubbed, or hardcoded

| What is faked | Where (file:line or folder) | Why we mocked it | What the real version would do |
|---|---|---|---|
| GBA destination figures (rent, cost-of-living, care-home price, cantonese/air/green/amenity 0–1 proxies) | `backend/data/destinations.json`, `backend/seed_gba.py` | The two HK open datasets don't cover mainland China; values are **modeled** from Numbeo / livingcost-type research and **tuned so the ranking visibly reacts** in the demo | Pull real mainland cost/livability data per city; values badged `modeled` in the provenance map |
| EHCV / GDRCS / cross-border travel fields per city | `destinations.json`, `voucher_hospitals.json` | **Hardcoded** from government sources (EHCV GBA pilot, SWD GDRCS list, MTR/HSR/HZMB fares) — not a live feed | Live integration with the relevant gov registries |
| Resident "auth" verifies format only | `backend/app.py:43` (`_HKID_RE`), `register`/`login` | No real identity provider available at a hackathon | Any well-formed HKID can register/login; there is **no** real identity check, no password, no document match. `ehealth_consent` is just a stored checkbox |
| Government console has **no authentication** | `backend/app.py` — `/api/applications`, `/api/applications/{id}/decision`, `/api/stats`, `/api/applications/{id}/events` | Out of scope for the demo | Any client can list applications, approve/reject, and read stats. Officer name defaults to a hardcoded `"Officer Lam"` |
| Uploaded documents are stored but **never processed/verified** | `backend/app.py` `upload_document`; `backend/data/uploads/` | OCR / verification out of scope | Files are written to disk and listed; no validation, OCR, or authenticity check |
| Seeded demo applications (fictional residents) | `backend/seed_applications.py` (Mr Chan Tai-man, etc.) | So a fresh DB demos well and the stats dashboard has data | These are invented people/profiles; the matches/projections on them *are* computed by the real scoring code |
| Projection numbers (net savings, runway, GBA time-to-care, return burden, projected wellbeing) | `backend/projections.py`, constants in `backend/config.py` | Modeled formulas with hardcoded constants (HK baseline rent/COL/care, return-trip model, GBA wait of 1 or 4 weeks). HK SOP wait is real; the GBA side is **modeled** | Calibrate against real cost and cross-border-care data; all badged `modeled` except the HK SOP wait (`real`) |
| Benefit values in the ledger | `backend/benefits.py`, `config.py` | Allowance amounts (OAA/OALA, EHCV) are **real**; public-housing implicit subsidy (HK$5,000) and community-services value (HK$800) are **modeled** constants | Source per-household subsidy values |
| "No-lift / not step-free" signal | `backend/ingest.py` `is_no_lift` (`config.OLD_AGE_YEARS=40`, `LOW_RISE_STOREYS=7`) | No dataset of actual lift installations exists; we infer it | Heuristic: old (≥40 yr) + low-rise (≤7 storeys) ⇒ likely walk-up. Not real lift records |
| Voice "assistant" is scripted TTS, not a conversational AI | `frontend-resident/src/hooks/useElevenLabs.ts`, `SpeechAvatar.tsx`, i18n strings spoken in `ResidentWizard.tsx` | We wanted an accessible spoken guide, not an LLM agent | It reads **fixed UI/dictionary strings** aloud via ElevenLabs. There is no LLM, no dialogue understanding, no generated text anywhere in the project |
| Community-graph matching (the "keep communities together" pitch) | **Not implemented** (docs/PIPELINE.txt Stage 2) | Time | The business video says 安居 "learns what seniors share and moves people from similar backgrounds to the same places." That social-graph clustering / cluster-matching is **not built** — matching is per-individual via the weighted score |
| Systemic-impact simulation / freed-unit cascade ("digital twin") | **Not implemented** (docs/PIPELINE.txt Stage 4) | Time | `/api/stats` exposes a `units_freed` counter, but there is **no** simulation of waitlist relief or live network rebalancing |

---

## 4. External APIs, services & data sources

| Service / API / dataset | Used for | Real call or mocked? | Auth |
|---|---|---|---|
| CSDI OGC WFS — LandsD OpenMap "Building" (`landsd_rcd_1637211194312_35158`) | Building footprints + height | **Real** (live WFS in `ingest.py`, then cached) | None |
| CSDI OGC WFS — BD "Building information & age records" (`bd_rcd_1631167534872_19764`) | Building age + address | **Real** (live WFS, then cached) | None |
| HA Specialist-Outpatient waiting-time open data | HK time-to-care | **Real snapshot** cached to `hk_sop_waits.json` (sourced from the live HA feed, verified 2026-06-07); not fetched live at runtime | None |
| ElevenLabs Text-to-Speech API | Spoken accessibility guide (reads fixed strings) | **Real** API call from the browser | API key in `frontend-resident/.env` (gitignored; **not** committed). Note: the key is bundled into the client and exposed to the browser — see §6 |
| CARTO basemap tiles (`basemaps.cartocdn.com/.../positron`) | MapLibre GL basemap | **Real** | None (public tiles) |
| EHCV designated GBA service points / GDRCS care-home list | Care eligibility per city | **Hardcoded** from gov sources (`voucher_hospitals.json`, `destinations.json`) — not a live API | n/a |
| GBA destination cost / livability figures | Match score & projections | **Mocked/modeled** seed data | n/a |

---

## 5. Pre-existing code

| Item | Source (URL or description) | Roughly how much | License |
|---|---|---|---|
| React + Vite + TypeScript project scaffold (both frontends) | `npm create vite` template (config, `index.html`, `main.tsx` bootstrap, tsconfig) | Small — standard generated boilerplate | MIT |
| FastAPI / Uvicorn / Shapely / httpx / Pydantic etc. | Standard PyPI dependencies (`backend/requirements.txt`) | Libraries only, not our code | Respective OSS licenses |
| MapLibre GL JS | Map rendering library (npm dependency) | Library only | BSD-3 |

All **application** code (backend logic, ingest/join, scoring/projections/benefits, both frontends' components/views) was written during the hackathon window. Only the standard framework scaffolding above pre-existed.
---

## 6. Known limitations & next steps

- **No real authentication or identity verification.** Residents register with a format-valid HKID only (no password / no ID match); the government console has **no auth at all**. Production needs iAM Smart / a real IdP and role-based access.
- **GBA destination data is illustrative.** Costs and livability proxies are modeled and tuned for the demo; they should be replaced with real per-city data before any real ranking is trusted.
- **The two headline differentiators from the business video are not built yet:** (1) community-graph matching that moves people from similar backgrounds to the same place, and (2) the systemic-impact / freed-unit "digital twin" simulation. Today matching is per-individual and the "units freed" figure is a count, not a simulation.
- **The match score is a transparent weighted sum, not ML.** Intentional and disclosed — but it is hand-tuned, not learned/validated.
- **Documents are stored, never verified.** No OCR or authenticity checking.
- **Demo data is seeded.** The stats dashboard and officer queue are populated by `seed_applications.py` with fictional residents.
- **Secret exposure:** the ElevenLabs API key is used directly from the browser (Vite `import.meta.env`), so it is bundled into the client. Fine for a demo (and the `.env` is gitignored), but a real build must proxy TTS through the backend.
- **No cloud deploy / no mobile.** Runs locally: FastAPI backend + two Vite dev servers, as documented in the README.
