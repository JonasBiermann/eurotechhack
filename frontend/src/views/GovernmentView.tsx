import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type Application, type District, type Destination, type Metric } from '../api/client';
import type { MapState } from '../map/MapCanvas';
import { ScoreDial, FactorBars } from '../components/MatchScore';

const METRICS: Metric[] = ['age', 'density', 'nolift'];
const GRADIENT: Record<Metric, string> = {
  age: 'linear-gradient(90deg,#0ea5a4,#fbbf24,#f97316,#ef4444)',
  density: 'linear-gradient(90deg,#134e4a,#2dd4bf,#fbbf24,#ef4444)',
  nolift: 'linear-gradient(90deg,#0ea5a4,#fbbf24,#f97316,#ef4444)',
};

export function GovernmentView({ setView }: { setView: (v: MapState) => void }) {
  const { t, L } = useI18n();
  const [tab, setTab] = useState<'heatmap' | 'apps'>('heatmap');
  const [metric, setMetric] = useState<Metric>('age');
  const [districts, setDistricts] = useState<District[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [sel, setSel] = useState<Application | null>(null);

  useEffect(() => {
    api.districts().then(setDistricts).catch(() => {});
    api.destinations().then(setDests).catch(() => {});
  }, []);

  const refreshApps = () => api.applications().then(setApps).catch(() => {});
  useEffect(() => { if (tab === 'apps') refreshApps(); }, [tab]);

  // drive the map
  useEffect(() => {
    if (tab === 'heatmap') {
      setView({ layer: 'heatmap', metric, origin: null, footprintsBbox: null,
        destinations: [], selectedDestId: null, focus: null });
    } else {
      const top = sel?.top_destination;
      setView({ layer: 'destinations', metric, origin: null, footprintsBbox: null,
        destinations: dests, selectedDestId: top?.id ?? null,
        focus: top ? { center: [top.lng, top.lat], zoom: 7 } : null });
    }
  }, [tab, metric, sel, dests, setView]);

  return (
    <div className="panel panel-left panel-wide">
      <div className="panel-head">
        <div className="seg violet" style={{ marginBottom: 14 }}>
          <button className={tab === 'heatmap' ? 'active' : ''} onClick={() => { setTab('heatmap'); setSel(null); }}>
            {t('gov.tab.heatmap')}</button>
          <button className={tab === 'apps' ? 'active' : ''} onClick={() => setTab('apps')}>
            {t('gov.tab.apps')}</button>
        </div>
      </div>

      {tab === 'heatmap'
        ? <HeatmapTab metric={metric} setMetric={setMetric} districts={districts}
            flyTo={(d) => setView({ layer: 'heatmap', metric, origin: null, footprintsBbox: null,
              destinations: [], selectedDestId: null, focus: { center: d.center, zoom: 14 } })} />
        : sel
          ? <Detail app={sel} onBack={() => setSel(null)}
              onDecided={async () => { await refreshApps(); const fresh = await api.application(sel.id); setSel(fresh); }} />
          : <Queue apps={apps} onPick={setSel} />}
    </div>
  );
}

function HeatmapTab({ metric, setMetric, districts, flyTo }: {
  metric: Metric; setMetric: (m: Metric) => void; districts: District[]; flyTo: (d: District) => void;
}) {
  const { t, L } = useI18n();
  return (
    <div className="panel-body" style={{ paddingTop: 0 }}>
      <h2 style={{ fontSize: 19 }}>{t('gov.heatmap.title')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '6px 0 16px', lineHeight: 1.5 }}>
        {t('gov.heatmap.sub')}</p>

      <div className="seg" style={{ width: '100%' }}>
        {METRICS.map((m) => (
          <button key={m} className={metric === m ? 'active' : ''} style={{ flex: 1 }}
            onClick={() => setMetric(m)}>{t(`metric.${m}`)}</button>
        ))}
      </div>

      <div className="legend">
        <div className="unit">{t(`metric.${metric}.unit`)}</div>
        <div className="bar" style={{ background: GRADIENT[metric] }} />
        <div className="ends"><span>{t('gov.legend.low')}</span><span>{t('gov.legend.high')}</span></div>
      </div>

      <div className="group-title" style={{ marginTop: 22 }}>{t('gov.districts')}</div>
      {districts.map((d) => (
        <button key={d.id} className="dstat" style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
          onClick={() => flyTo(d)}>
          <div className="row1">
            <h4>{L(d, 'name')}</h4>
            <span className="pct" style={{ color: 'var(--gold)' }}>{d.pct_no_lift ?? '–'}%</span>
          </div>
          <div className="row2">
            <span>{d.count} {t('stat.buildings')}</span>
            <span>{t('stat.meanAge')} <b>{d.mean_age}</b></span>
            <span>{t('stat.oldest')} <b>{d.oldest_age}</b></span>
            <span>{t('stat.noLift')}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Queue({ apps, onPick }: { apps: Application[]; onPick: (a: Application) => void }) {
  const { t, L } = useI18n();
  const pending = apps.filter((a) => a.status === 'submitted' || a.status === 'under_review').length;
  const approved = apps.filter((a) => a.status === 'approved').length;
  return (
    <div className="panel-body" style={{ paddingTop: 0 }}>
      <h2 style={{ fontSize: 19, marginBottom: 14 }}>{t('apps.title')}</h2>
      <div className="kpis">
        <div className="kpi"><b>{apps.length}</b><small>{t('apps.title')}</small></div>
        <div className="kpi"><b style={{ color: 'var(--gold)' }}>{pending}</b><small>{t('status.under_review')}</small></div>
        <div className="kpi"><b style={{ color: 'var(--success)' }}>{approved}</b><small>{t('status.approved')}</small></div>
      </div>
      {apps.length === 0 && <div className="center-msg">{t('apps.empty')}</div>}
      <div className="queue">
        {apps.map((a) => (
          <button key={a.id} className="qrow" onClick={() => onPick(a)}>
            <div className="top">
              <b>{a.applicant_name || `#${a.id}`}</b>
              <span className={`badge badge-${a.status}`}>{t(`status.${a.status}`)}</span>
            </div>
            <div className="sub">
              → {a.top_destination ? L(a.top_destination, 'name') : '–'}
              {a.top_destination?.match && ` · ${Math.round(a.top_destination.match.score)}/100`}
              {` · ${a.documents.length} ${t('apps.docs')}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Detail({ app, onBack, onDecided }: {
  app: Application; onBack: () => void; onDecided: () => void;
}) {
  const { t, L, lang } = useI18n();
  const [note, setNote] = useState(app.note ?? '');
  const [saving, setSaving] = useState(false);
  const top = app.top_destination;

  const decide = async (decision: string) => {
    setSaving(true);
    try { await api.decide(app.id, decision, note); await onDecided(); }
    finally { setSaving(false); }
  };

  const p = app.profile;
  return (
    <div className="panel-body" style={{ paddingTop: 0 }}>
      <button className="drawer-back" onClick={onBack}>← {t('apps.title')}</button>
      <div className="row1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 20 }}>{app.applicant_name || `#${app.id}`}</h2>
        <span className={`badge badge-${app.status}`}>{t(`status.${app.status}`)}</span>
      </div>

      <div className="kv"><span>{t('apps.origin')}</span><b>{app.origin_address || '–'}</b></div>
      <div className="kv"><span>{t('apps.topChoice')}</span><b>{top ? L(top, 'name') : '–'}</b></div>
      <div className="kv"><span>{t('p.budget')}</span><b>{t('common.hkd')}{p.monthly_budget?.toLocaleString()}{t('common.perMonth')}</b></div>
      <div className="kv"><span>{t('p.stepFree')}</span><b>{p.needs_step_free ? '✓' : '–'}</b></div>
      <div className="kv"><span>{t('p.careLevel')}</span><b>{t(`care.${p.care_level ?? 0}`)}</b></div>

      {top?.match && (
        <>
          <div className="group-title">{t('apps.profileSummary')}</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <ScoreDial score={top.match.score} />
            <div style={{ flex: 1 }}><FactorBars factors={top.match.factors} /></div>
          </div>
        </>
      )}

      <div className="group-title">{t('apps.docs')} ({app.documents.length})</div>
      {app.documents.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('docs.none')}</div>}
      {app.documents.map((d) => (
        <a className="doc" key={d.id} href={`/api/applications/${app.id}/documents/${d.id}`} target="_blank" rel="noreferrer">
          <span>📄</span><span className="fname">{d.filename}</span>
          <span style={{ color: 'var(--muted)' }}>{(d.size / 1024).toFixed(1)} KB</span>
        </a>
      ))}

      <div className="group-title">{t('apps.decision')}</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('apps.notePh')} />
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn grow" disabled={saving} onClick={() => decide('under_review')}>{t('apps.review')}</button>
        <button className="btn btn-danger" disabled={saving} onClick={() => decide('rejected')}>{t('apps.reject')}</button>
        <button className="btn btn-primary" disabled={saving} onClick={() => decide('approved')}>{t('apps.approve')}</button>
      </div>
      {app.decided_at && <div className="seeded-note">{t('apps.saved')} · {new Date(app.decided_at).toLocaleString(lang === 'en' ? 'en-HK' : 'zh-HK')}</div>}
    </div>
  );
}
