import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import {
  api, type Application, type District, type Metric, type NewTown,
} from '../api/client';
import type { MapState } from '../map/MapCanvas';

const METRICS: Metric[] = ['age', 'density', 'nolift'];
const GRADIENT: Record<Metric, string> = {
  age: 'linear-gradient(90deg,#0ea5a4,#fbbf24,#f97316,#ef4444)',
  density: 'linear-gradient(90deg,#134e4a,#2dd4bf,#fbbf24,#ef4444)',
  nolift: 'linear-gradient(90deg,#0ea5a4,#fbbf24,#f97316,#ef4444)',
};

export function GovernmentView({ view, setView }: {
  view: MapState;
  setView: (v: MapState) => void;
}) {
  const { t, L } = useI18n();
  const [tab, setTab] = useState<'map' | 'requests'>('map');
  const [metric, setMetric] = useState<Metric>('age');
  const [districts, setDistricts] = useState<District[]>([]);
  const [newTowns, setNewTowns] = useState<NewTown[]>([]);
  const [apps, setApps] = useState<Application[]>([]);

  const [drawer, setDrawer] = useState<Application | null>(null);

  const pendingCount = apps.filter(
    (a) => a.status === 'submitted' || a.status === 'under_review',
  ).length;

  useEffect(() => {
    api.districts().then(setDistricts).catch(() => {});
    api.newTowns().then(setNewTowns).catch(() => {});
    api.applications().then(setApps).catch(() => {});
  }, []);

  useEffect(() => {
    setView({
      ...view,
      layer: 'heatmap',
      metric,
      newTowns,
      destinations: [], selectedDestId: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, newTowns]);

  const refreshApps = async () => {
    const a = await api.applications();
    setApps(a);
  };

  const flyDistrict = (d: District) => setView({
    ...view, layer: 'heatmap', metric, newTowns,
    focus: { center: d.center, zoom: 13.4 },
  });
  const flyNewTown = (nt: NewTown) => setView({
    ...view, layer: 'heatmap', metric, newTowns,
    focus: { center: [nt.lng, nt.lat], zoom: 12.5 },
  });

  return (
    <>
      <div className="panel panel-left panel-console">
        <div className="console-tabs">
          <button className={`console-tab ${tab === 'map' ? 'active' : ''}`}
            onClick={() => setTab('map')}>
            {t('tab.map')}
          </button>
          <button className={`console-tab ${tab === 'requests' ? 'active' : ''}`}
            onClick={() => setTab('requests')}>
            {t('tab.requests')}
            {pendingCount > 0 && <span className="tab-badge">{pendingCount}</span>}
          </button>
        </div>

        <div className="panel-body console-body">
          {tab === 'map' ? (
            <>
              <Section title={t('sec.pressure')}>
                <p className="section-sub">{t('pressure.title')}</p>
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
                <div className="district-strip">
                  {districts.map((d) => (
                    <button key={d.id} className="dchip" onClick={() => flyDistrict(d)}>
                      <b>{L(d, 'name')}</b>
                      <span>{d.pct_no_lift ?? '–'}% {t('stat.noLift')}</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title={t('sec.newtowns')}>
                <p className="section-sub">{t('nt.intro')}</p>
                <div className="nt-grid">
                  {newTowns.map((nt) => {
                    const pct = Math.min(100, Math.round((nt.available_units / nt.planned_units) * 100));
                    return (
                      <button key={nt.id} className="nt-card" onClick={() => flyNewTown(nt)}>
                        <div className="nt-head">
                          <b>{L(nt, 'name')}</b>
                          <span className="nt-units">{nt.available_units.toLocaleString()}</span>
                        </div>
                        <div className="nt-bar"><div className="nt-bar-fill" style={{ width: `${pct}%` }} /></div>
                        <div className="nt-meta">
                          <span>{t('nt.available')}</span>
                          <span>{t('nt.planned')} {nt.planned_units.toLocaleString()}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Section>
            </>
          ) : (
            <Section title={t('sec.requests')}>
              <p className="section-sub">{t('req.intro')}</p>
              <RequestsList apps={apps} onPick={setDrawer} selectedId={drawer?.id ?? null} />
            </Section>
          )}
        </div>
      </div>

      {drawer && <DetailDrawer app={drawer} onClose={() => setDrawer(null)}
        onDecided={async () => {
          await refreshApps();
          const fresh = await api.application(drawer.id);
          setDrawer(fresh);
        }} />}
    </>
  );
}

// ============================================================== sub-components

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div className="console-section">
      <div className="console-section-head">{title}</div>
      <div className="console-section-body">{children}</div>
    </div>
  );
}

type ReqFilter = 'all' | 'submitted' | 'under_review' | 'approved' | 'rejected';

function RequestsList({ apps, onPick, selectedId }: {
  apps: Application[]; onPick: (a: Application) => void; selectedId: number | null;
}) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<ReqFilter>('all');

  const counts = useMemo(() => ({
    all: apps.length,
    submitted: apps.filter((a) => a.status === 'submitted').length,
    under_review: apps.filter((a) => a.status === 'under_review').length,
    approved: apps.filter((a) => a.status === 'approved').length,
    rejected: apps.filter((a) => a.status === 'rejected').length,
  }), [apps]);

  const filtered = useMemo(
    () => filter === 'all' ? apps : apps.filter((a) => a.status === filter),
    [apps, filter],
  );

  const FILTERS: { key: ReqFilter; label: string; tone: string }[] = [
    { key: 'all',          label: t('req.all'),      tone: 'neutral' },
    { key: 'submitted',    label: t('req.new'),      tone: 'info' },
    { key: 'under_review', label: t('req.review'),   tone: 'gold' },
    { key: 'approved',     label: t('req.approved'), tone: 'success' },
    { key: 'rejected',     label: t('req.closed'),   tone: 'danger' },
  ];

  return (
    <>
      <div className="req-filters">
        {FILTERS.map((f) => (
          <button key={f.key}
            className={`req-filter tone-${f.tone} ${filter === f.key ? 'on' : ''}`}
            onClick={() => setFilter(f.key)}>
            <span>{f.label}</span>
            <b>{counts[f.key]}</b>
          </button>
        ))}
      </div>

      {filtered.length === 0 && <div className="center-msg">{t('req.empty')}</div>}

      <div className="req-list">
        {filtered.map((a) => {
          const top = a.top_destination;
          const score = top?.match ? Math.round(top.match.score) : null;
          const days = Math.max(0, Math.floor(
            (Date.now() - new Date(a.created_at).getTime()) / 86_400_000,
          ));
          const ageLabel = days === 0 ? t('req.today') : `${days}${t('req.daysAgo')}`;
          const dest = top ? (lang === 'en' ? top.name_en : top.name_tc) : '–';
          return (
            <button key={a.id}
              className={`req-row ${selectedId === a.id ? 'sel' : ''}`}
              onClick={() => onPick(a)}>
              <div className="req-row-top">
                <b>{a.applicant_name || `#${a.id}`}</b>
                <span className={`badge badge-${a.status}`}>{t(`status.${a.status}`)}</span>
              </div>
              <div className="req-row-flow">
                <span className="req-from">{a.origin_address || '–'}</span>
                <span className="req-arrow">→</span>
                <span className="req-to">{dest}</span>
              </div>
              <div className="req-row-meta">
                {score !== null && (
                  <span className={`req-score ${score >= 75 ? 'hi' : score >= 60 ? 'mid' : 'lo'}`}>
                    {score} <small>{t('req.match')}</small>
                  </span>
                )}
                <span className="req-meta-item">{t(`care.${a.profile.care_level ?? 0}`)}</span>
                {a.documents.length > 0 && (
                  <span className="req-meta-item">📎 {a.documents.length} {t('req.docs')}</span>
                )}
                <span className="req-meta-item req-age">{ageLabel}</span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function DetailDrawer({ app, onClose, onDecided }: {
  app: Application; onClose: () => void; onDecided: () => void;
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
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{app.applicant_name || `#${app.id}`}</h2>
          <span className={`badge badge-${app.status}`}>{t(`status.${app.status}`)}</span>
          <button className="drawer-x" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          <div className="kv"><span>{t('apps.origin')}</span><b>{app.origin_address || '–'}</b></div>
          <div className="kv"><span>{t('apps.topChoice')}</span><b>{top ? L(top, 'name') : '–'}</b></div>
          <div className="kv"><span>{t('p.budget')}</span><b>{t('common.hkd')}{p.monthly_budget?.toLocaleString()}{t('common.perMonth')}</b></div>
          <div className="kv"><span>{t('p.stepFree')}</span><b>{p.needs_step_free ? '✓' : '–'}</b></div>
          <div className="kv"><span>{t('p.careLevel')}</span><b>{t(`care.${p.care_level ?? 0}`)}</b></div>

          {top?.match && (
            <>
              <div className="group-title">{t('apps.profileSummary')}</div>
              <div className="factors">
                {top.match.factors.map((f) => (
                  <div className="fbar" key={f.key}>
                    <div className="flabel">
                      <span>{lang === 'en' ? f.label_en : f.label_tc}</span>
                      <span>{Math.round(f.value * 100)}%</span>
                    </div>
                    <div className="ftrack"><div className="ffill" style={{ width: `${f.value * 100}%` }} /></div>
                  </div>
                ))}
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
        </div>
      </div>
    </div>
  );
}
