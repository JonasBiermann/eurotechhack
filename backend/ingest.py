"""Ingest the two HK backbone datasets into local artifacts (pre-seeded; no live
pulls at demo time).

  LandsD csdi:Building  (polygons + BaseHeight/TopHeight/Storeys)  -> footprints
  BD     csdi:BDBIAR    (points + address + OP date)              -> age, address

Pipeline: page WFS per district bbox -> cache raw -> point-in-polygon join
(BD age × footprint height) -> SQLite bd_records + buildings.geojson +
heatmap_{age,density,nolift}.json + districts.json. Prints counts and join rate.

Run from the backend/ directory:  python ingest.py   (add --refresh to ignore cache)
"""
import json
import math
import sys
from collections import defaultdict

import httpx
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

import config
import db

GRID_DEG = 0.003                       # ~330 m heatmap cells
JOIN_SNAP_DEG = 0.0003                 # ~33 m: snap a BD point to nearest footprint
REFRESH = "--refresh" in sys.argv


# --------------------------------------------------------------------------- WFS

def _wfs_page(client: httpx.Client, dataset: str, layer: str, bbox_str: str,
              start: int) -> list[dict]:
    url = config.WFS_BASE.format(dataset=dataset)
    params = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": layer, "outputFormat": "GeoJSON", "srsName": "EPSG:4326",
        "bbox": bbox_str, "count": config.WFS_PAGE, "startIndex": start,
    }
    r = client.get(url, params=params, timeout=90)
    r.raise_for_status()
    return json.loads(r.text).get("features", [])


def fetch_layer(client: httpx.Client, dataset: str, layer: str,
                bbox: tuple[float, float, float, float], cache_name: str) -> list[dict]:
    """All features for a layer within bbox (paginated), with on-disk caching.

    bbox is (min_lat, min_lng, max_lat, max_lng). Tries lat,lng axis order first
    (WFS 2.0 + EPSG:4326), falling back to lng,lat if that returns nothing.
    """
    cache = config.RAW_DIR / f"{cache_name}.geojson"
    if cache.exists() and not REFRESH:
        feats = json.loads(cache.read_text()).get("features", [])
        print(f"  [cache] {cache_name}: {len(feats)} features")
        return feats

    min_lat, min_lng, max_lat, max_lng = bbox
    orders = [f"{min_lat},{min_lng},{max_lat},{max_lng}",
              f"{min_lng},{min_lat},{max_lng},{max_lat}"]
    features: list[dict] = []
    for bbox_str in orders:
        features, start = [], 0
        while True:
            page = _wfs_page(client, dataset, layer, bbox_str, start)
            features.extend(page)
            if len(page) < config.WFS_PAGE:
                break
            start += config.WFS_PAGE
        if features:
            break

    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"  [fetch] {cache_name}: {len(features)} features")
    return features


# ----------------------------------------------------------------------- derive

def parse_op_year(value) -> int | None:
    """'3/5/1984' (D/M/YYYY) -> 1984."""
    if not value:
        return None
    try:
        parts = str(value).strip().split("/")
        year = int(parts[-1])
        return year if 1850 <= year <= config.REFERENCE_YEAR else None
    except (ValueError, IndexError):
        return None


def footprint_height(props: dict) -> float | None:
    base, top = props.get("BaseHeight"), props.get("TopHeight")
    if base is None or top is None:
        return None
    h = float(top) - float(base)
    return h if h > 0 else None


def storeys_estimate(props: dict, height_m: float | None) -> int | None:
    s = props.get("Storeys")
    if s:
        try:
            return int(s)
        except (ValueError, TypeError):
            pass
    if height_m:
        return max(1, round(height_m / config.METERS_PER_STOREY))
    return None


def is_no_lift(age_years: int | None, storeys: int | None) -> int | None:
    """Likely walk-up / no lift. Age is the strong signal; height refines it."""
    if age_years is None:
        return None
    if storeys is not None:
        return 1 if (age_years >= config.OLD_AGE_YEARS and storeys <= config.LOW_RISE_STOREYS) else 0
    # No height known: only very old buildings are confidently walk-ups.
    return 1 if age_years >= 55 else None


# -------------------------------------------------------------------------- main

def main() -> None:
    db.init_db()
    conn = db.connect()
    db.reset_bd_records(conn)

    polygons: list = []          # shapely geoms (footprints)
    foot_meta: list[dict] = []   # parallel: {id, height_m, storeys, props}
    foot_features: list[dict] = []  # raw geojson features (for buildings.geojson)
    bd_rows: list[dict] = []

    with httpx.Client(headers={"User-Agent": "SilverLink/1.0"}) as client:
        for d in config.DISTRICTS:
            print(f"District {d['name_en']} ({d['id']}):")
            foots = fetch_layer(client, **config.LANDSD_BUILDING, bbox=d["bbox"],
                                cache_name=f"{d['id']}_building")
            bds = fetch_layer(client, **config.BD_BUILDING, bbox=d["bbox"],
                              cache_name=f"{d['id']}_bd")

            for f in foots:
                geom = f.get("geometry")
                if not geom:
                    continue
                try:
                    g = shape(geom)
                except Exception:
                    continue
                if g.is_empty:
                    continue
                props = f.get("properties", {})
                h = footprint_height(props)
                fid = len(polygons)
                polygons.append(g)
                foot_meta.append({"id": fid, "height_m": h,
                                  "storeys": storeys_estimate(props, h), "props": props})
                foot_features.append(f)

            F = config.BD_FIELDS
            for f in bds:
                p = f.get("properties", {})
                lat, lng = p.get(F["lat"]), p.get(F["lng"])
                if lat is None or lng is None:
                    coords = (f.get("geometry") or {}).get("coordinates")
                    if coords:
                        lng, lat = coords[0], coords[1]
                if lat is None or lng is None:
                    continue
                op_year = parse_op_year(p.get(F["op_date"]))
                bd_rows.append({
                    "district_id": d["id"],
                    "address_en": p.get(F["address_en"]), "address_tc": p.get(F["address_tc"]),
                    "district_en": p.get(F["district_en"]), "district_tc": p.get(F["district_tc"]),
                    "region_en": p.get(F["region_en"]), "region_tc": p.get(F["region_tc"]),
                    "block_id": str(p.get(F["block_id"]) or ""),
                    "op_number": p.get(F["op_number"]), "op_date": p.get(F["op_date"]),
                    "op_year": op_year,
                    "age_years": (config.REFERENCE_YEAR - op_year) if op_year else None,
                    "type_en": p.get(F["type_en"]), "type_tc": p.get(F["type_tc"]),
                    "usage_en": p.get(F["usage_en"]), "usage_tc": p.get(F["usage_tc"]),
                    "lat": float(lat), "lng": float(lng),
                })

    # ---- spatial join: BD point -> containing/nearest footprint -------------
    tree = STRtree(polygons) if polygons else None
    foot_ages: dict[int, list[int]] = defaultdict(list)
    joined = 0
    for row in bd_rows:
        pt = Point(row["lng"], row["lat"])
        chosen = None
        if tree is not None:
            for i in tree.query(pt):
                if polygons[int(i)].covers(pt):
                    chosen = int(i)
                    break
            if chosen is None:
                ni = int(tree.nearest(pt))
                if polygons[ni].distance(pt) <= JOIN_SNAP_DEG:
                    chosen = ni
        if chosen is not None:
            meta = foot_meta[chosen]
            row["footprint_id"] = meta["id"]
            row["height_m"] = meta["height_m"]
            row["storeys_est"] = meta["storeys"]
            joined += 1
            if row["age_years"] is not None:
                foot_ages[chosen].append(row["age_years"])
        else:
            row["footprint_id"] = None
            row["height_m"] = None
            row["storeys_est"] = None
        row["no_lift"] = is_no_lift(row["age_years"], row["storeys_est"])
        row["lift_likely"] = (None if row["no_lift"] is None else int(not row["no_lift"]))

    # ---- write bd_records ---------------------------------------------------
    cols = ["district_id", "address_en", "address_tc", "district_en", "district_tc",
            "region_en", "region_tc", "block_id", "op_number", "op_date", "op_year",
            "age_years", "type_en", "type_tc", "usage_en", "usage_tc", "lat", "lng",
            "footprint_id", "height_m", "storeys_est", "no_lift", "lift_likely"]
    conn.executemany(
        f"INSERT INTO bd_records ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        [[row.get(c) for c in cols] for row in bd_rows],
    )
    conn.commit()

    # ---- buildings.geojson (footprints + joined oldest age + no_lift) -------
    out_features = []
    for meta, feat in zip(foot_meta, foot_features):
        ages = foot_ages.get(meta["id"], [])
        age = max(ages) if ages else None
        props = meta["props"]
        out_features.append({
            "type": "Feature",
            "geometry": _round_geom(feat["geometry"]),
            "properties": {
                "id": meta["id"],
                "block_type": props.get("BuildingBlockType"),
                "name_en": props.get("BuildingNameEN"),
                "name_tc": props.get("BuildingNameTC"),
                "height_m": round(meta["height_m"], 1) if meta["height_m"] else None,
                "storeys_est": meta["storeys"],
                "age_years": age,
                "no_lift": is_no_lift(age, meta["storeys"]),
            },
        })
    config.BUILDINGS_GEOJSON.write_text(
        json.dumps({"type": "FeatureCollection", "features": out_features}))

    # ---- heatmap grids + district stats ------------------------------------
    write_heatmaps(bd_rows)
    write_districts(bd_rows)

    # ---- summary ------------------------------------------------------------
    n_age = sum(1 for r in bd_rows if r["age_years"] is not None)
    rate = (joined / len(bd_rows) * 100) if bd_rows else 0
    print("\n=== INGEST SUMMARY ===")
    print(f"  footprints (LandsD):       {len(polygons)}")
    print(f"  BD records:                {len(bd_rows)}  (with age: {n_age})")
    print(f"  joined to a footprint:     {joined}  ({rate:.1f}%)")
    print(f"  buildings.geojson:         {len(out_features)} features")
    conn.close()


def _round_geom(geom: dict) -> dict:
    def r(c):
        if isinstance(c, (int, float)):
            return round(c, 6)
        return [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def write_heatmaps(bd_rows: list[dict]) -> None:
    cells: dict[tuple[int, int], dict] = defaultdict(
        lambda: {"count": 0, "age_sum": 0, "age_n": 0, "nl": 0, "nl_n": 0})
    for r in bd_rows:
        key = (math.floor(r["lat"] / GRID_DEG), math.floor(r["lng"] / GRID_DEG))
        c = cells[key]
        c["count"] += 1
        if r["age_years"] is not None:
            c["age_sum"] += r["age_years"]
            c["age_n"] += 1
        if r["no_lift"] is not None:
            c["nl_n"] += 1
            c["nl"] += r["no_lift"]

    def cell_polygon(key):
        glat, glng = key
        lat0, lng0 = glat * GRID_DEG, glng * GRID_DEG
        lat1, lng1 = lat0 + GRID_DEG, lng0 + GRID_DEG
        return [[[lng0, lat0], [lng1, lat0], [lng1, lat1], [lng0, lat1], [lng0, lat0]]]

    metrics = {"age": [], "density": [], "nolift": []}
    for key, c in cells.items():
        mean_age = round(c["age_sum"] / c["age_n"], 1) if c["age_n"] else None
        pct_no_lift = round(c["nl"] / c["nl_n"] * 100, 1) if c["nl_n"] else None
        base = {"count": c["count"], "mean_age": mean_age, "pct_no_lift": pct_no_lift}
        geom = {"type": "Polygon", "coordinates": cell_polygon(key)}
        if mean_age is not None:
            metrics["age"].append({"type": "Feature", "geometry": geom,
                                   "properties": {**base, "value": mean_age}})
        metrics["density"].append({"type": "Feature", "geometry": geom,
                                   "properties": {**base, "value": c["count"]}})
        if pct_no_lift is not None:
            metrics["nolift"].append({"type": "Feature", "geometry": geom,
                                      "properties": {**base, "value": pct_no_lift}})

    for name, feats in metrics.items():
        config.HEATMAP_FILES[name].write_text(
            json.dumps({"type": "FeatureCollection", "features": feats}))
        print(f"  heatmap[{name}]: {len(feats)} cells")


def write_districts(bd_rows: list[dict]) -> None:
    out = []
    for d in config.DISTRICTS:
        rows = [r for r in bd_rows if r["district_id"] == d["id"]]
        ages = [r["age_years"] for r in rows if r["age_years"] is not None]
        nl = [r["no_lift"] for r in rows if r["no_lift"] is not None]
        min_lat, min_lng, max_lat, max_lng = d["bbox"]
        out.append({
            "id": d["id"], "name_en": d["name_en"], "name_tc": d["name_tc"],
            "center": [(min_lng + max_lng) / 2, (min_lat + max_lat) / 2],
            "bbox": [min_lng, min_lat, max_lng, max_lat],
            "count": len(rows),
            "mean_age": round(sum(ages) / len(ages), 1) if ages else None,
            "oldest_age": max(ages) if ages else None,
            "pct_no_lift": round(sum(nl) / len(nl) * 100, 1) if nl else None,
        })
    config.DISTRICTS_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"  districts.json: {len(out)} districts")


if __name__ == "__main__":
    main()
