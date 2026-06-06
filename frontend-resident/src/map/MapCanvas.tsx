import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, type Destination, type Metric } from '../api/client';
import type { Lang } from '../i18n/dict';

export interface MapState {
  layer: 'heatmap' | 'destinations' | 'none';
  metric: Metric;
  origin: { lng: number; lat: number; label: string } | null;
  footprintsBbox: string | null;
  destinations: Destination[];
  selectedDestId: string | null;
  focus: { center: [number, number]; zoom: number } | null;
}

const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const HK_BOUNDS: [number, number, number, number] = [114.14, 22.255, 114.255, 22.355];

// metric -> color interpolate stops on properties.value
const RAMPS: Record<Metric, [number, string][]> = {
  age: [[20, '#0ea5a4'], [35, '#fbbf24'], [50, '#f97316'], [72, '#ef4444']],
  density: [[1, '#134e4a'], [40, '#2dd4bf'], [90, '#fbbf24'], [170, '#ef4444']],
  nolift: [[0, '#0ea5a4'], [25, '#fbbf24'], [55, '#f97316'], [100, '#ef4444']],
};

function colorByValue(metric: Metric): any {
  const expr: any[] = ['interpolate', ['linear'], ['get', 'value']];
  for (const [stop, col] of RAMPS[metric]) expr.push(stop, col);
  return expr;
}
function scoreColor(): any {
  return ['interpolate', ['linear'], ['get', 'score'],
    40, '#fb7185', 60, '#fbbf24', 75, '#34d399', 90, '#2dd4bf'];
}

export function MapCanvas({ view, lang }: { view: MapState; lang: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const marker = useRef<maplibregl.Marker | null>(null);
  const heatCache = useRef<Record<string, any>>({});
  const prevLayer = useRef<string>('');

  // create once
  useEffect(() => {
    if (!ref.current) return;
    const m = new maplibregl.Map({
      container: ref.current, style: STYLE,
      bounds: HK_BOUNDS, fitBoundsOptions: { padding: 80 }, attributionControl: false,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true }));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.on('load', () => { ready.current = true; apply(); });
    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-apply on prop change
  useEffect(() => { if (ready.current) apply(); /* eslint-disable-next-line */ }, [view, lang]);

  function removeLayer(id: string) {
    const m = map.current!;
    if (m.getLayer(id)) m.removeLayer(id);
  }
  function removeSource(id: string) {
    const m = map.current!;
    if (m.getSource(id)) m.removeSource(id);
  }

  async function apply() {
    const m = map.current;
    if (!m || !ready.current) return;

    // ---- heatmap ----
    if (view.layer === 'heatmap') {
      let data = heatCache.current[view.metric];
      if (!data) {
        try { data = await api.heatmap(view.metric); heatCache.current[view.metric] = data; }
        catch { data = { type: 'FeatureCollection', features: [] }; }
      }
      if (m.getSource('heat')) (m.getSource('heat') as maplibregl.GeoJSONSource).setData(data);
      else m.addSource('heat', { type: 'geojson', data });
      if (!m.getLayer('heat-fill')) {
        m.addLayer({ type: 'fill', id: 'heat-fill', source: 'heat',
          paint: { 'fill-color': colorByValue(view.metric), 'fill-opacity': 0.6 } });
        m.addLayer({ type: 'line', id: 'heat-line', source: 'heat',
          paint: { 'line-color': 'rgba(255,255,255,0.12)', 'line-width': 0.5 } });
      } else {
        m.setPaintProperty('heat-fill', 'fill-color', colorByValue(view.metric));
      }
    } else {
      removeLayer('heat-fill'); removeLayer('heat-line'); removeSource('heat');
    }

    // ---- destination pins ----
    if (view.layer === 'destinations') {
      const fc = {
        type: 'FeatureCollection',
        features: view.destinations.map((d) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
          properties: { id: d.id, name: lang === 'en' ? d.name_en : d.name_tc,
            score: d.match?.score ?? 0, sel: d.id === view.selectedDestId ? 1 : 0 },
        })),
      };
      if (m.getSource('dests')) (m.getSource('dests') as maplibregl.GeoJSONSource).setData(fc as any);
      else m.addSource('dests', { type: 'geojson', data: fc as any });
      if (!m.getLayer('dest-pt')) {
        m.addLayer({ type: 'circle', id: 'dest-halo', source: 'dests',
          paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 26, 0],
            'circle-color': '#2dd4bf', 'circle-opacity': 0.18 } });
        m.addLayer({ type: 'circle', id: 'dest-pt', source: 'dests',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 40, 7, 90, 20],
            'circle-color': scoreColor(), 'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 2.5, 1],
          } });
        m.addLayer({ type: 'symbol', id: 'dest-label', source: 'dests',
          layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-offset': [0, 1.6],
            'text-anchor': 'top', 'text-font': ['Open Sans Bold'] },
          paint: { 'text-color': '#161b26', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 } });
      }
    } else {
      removeLayer('dest-halo'); removeLayer('dest-pt'); removeLayer('dest-label'); removeSource('dests');
    }

    // ---- footprints (resident building context) ----
    if (view.footprintsBbox) {
      try {
        const fc = await api.footprints(view.footprintsBbox);
        if (m.getSource('foot')) (m.getSource('foot') as maplibregl.GeoJSONSource).setData(fc as any);
        else m.addSource('foot', { type: 'geojson', data: fc as any });
        if (!m.getLayer('foot-fill')) {
          m.addLayer({ type: 'fill', id: 'foot-fill', source: 'foot',
            paint: { 'fill-color': ['case', ['==', ['get', 'no_lift'], 1], '#fb7185', '#2dd4bf'],
              'fill-opacity': 0.45 } });
          m.addLayer({ type: 'line', id: 'foot-line', source: 'foot',
            paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': 0.6 } });
        }
      } catch { /* ignore */ }
    } else {
      removeLayer('foot-fill'); removeLayer('foot-line'); removeSource('foot');
    }

    // ---- origin marker ----
    if (view.origin) {
      if (!marker.current) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:18px;height:18px;border-radius:50%;background:#a78bfa;border:3px solid #fff;' +
          'box-shadow:0 0 0 6px rgba(167,139,250,.35),0 0 14px rgba(167,139,250,.8)';
        marker.current = new maplibregl.Marker({ element: el });
      }
      marker.current.setLngLat([view.origin.lng, view.origin.lat]).addTo(m);
    } else if (marker.current) {
      marker.current.remove();
    }

    // ---- camera ----
    if (view.focus) {
      m.flyTo({ center: view.focus.center, zoom: view.focus.zoom, duration: 1100, essential: true });
    } else if (prevLayer.current !== view.layer) {
      if (view.layer === 'destinations' && view.destinations.length) {
        const b = new maplibregl.LngLatBounds();
        view.destinations.forEach((d) => b.extend([d.lng, d.lat]));
        if (view.origin) b.extend([view.origin.lng, view.origin.lat]);
        m.fitBounds(b, { padding: 110, duration: 1000 });
      } else if (view.layer === 'heatmap') {
        m.fitBounds(HK_BOUNDS, { padding: 80, duration: 800 });
      }
    }
    prevLayer.current = view.layer;
  }

  return (
    <>
      <div id="map" ref={ref} />
      <div className="map-fade" />
    </>
  );
}
