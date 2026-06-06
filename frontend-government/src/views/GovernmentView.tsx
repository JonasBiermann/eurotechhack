import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import {
  api, type Application, type CaseEvent, type CaseEventKind,
  type Destination, type District, type Metric,
} from '../api/client';
import type { MapState } from '../map/MapCanvas';
import { StatsView } from './StatsView';

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
  const [tab, setTab] = useState<'map' | 'requests' | 'stats'>('map');
  const [metric, setMetric] = useState<Metric>('age');
  const [districts, setDistricts] = useState<District[]>([]);
  const [gbaDests, setGbaDests] = useState<Destination[]>([]);
  const [apps, setApps] = useState<Application[]>([]);

  // Detail view replaces the list in-place — no drawer overlay.
  const [openId, setOpenId] = useState<number | null>(null);
  const openedApp = useMemo(
    () => apps.find((a) => a.id === openId) ?? null, [apps, openId],
  );

  const pendingCount = apps.filter(
    (a) => a.status === 'submitted' || a.status === 'under_review',
  ).length;

  useEffect(() => {
    api.districts().then(setDistricts).catch(() => {});
    api.destinations().then(setGbaDests).catch(() => {});
    api.applications().then(setApps).catch(() => {});
  }, []);

  useEffect(() => {
    setView({
      ...view,
      layer: 'heatmap',
      metric,
      gbaPins: gbaDests,
      destinations: [], selectedDestId: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, gbaDests]);

  const refreshApps = async () => {
    const a = await api.applications();
    setApps(a);
  };

  const flyDistrict = (d: District) => setView({
    ...view, layer: 'heatmap', metric, gbaPins: gbaDests,
    focus: { center: d.center, zoom: 13.4 },
  });
  const flyDest = (d: Destination) => setView({
    ...view, layer: 'heatmap', metric, gbaPins: gbaDests,
    focus: { center: [d.lng, d.lat], zoom: 9.5 },
  });

  // When a case is open, the whole panel renders the detail page.
  if (openedApp) {
    return (
      <div className="gov-console-panel">
        <CaseDetail
          app={openedApp}
          onBack={() => setOpenId(null)}
          onChanged={async () => {
            await refreshApps();
            const fresh = await api.application(openedApp.id);
            setApps((cur) => cur.map((a) => a.id === fresh.id ? fresh : a));
          }}
          flyDest={flyDest}
        />
      </div>
    );
  }

  return (
    <div className="gov-console-panel">
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
        <button className={`console-tab ${tab === 'stats' ? 'active' : ''}`}
          onClick={() => setTab('stats')}>
          {t('tab.stats')}
        </button>
      </div>

      <div className="panel-body console-body">
        {tab === 'stats' ? <StatsView /> : tab === 'map' ? (
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
                {gbaDests.map((d) => (
                  <button key={d.id} className="nt-card" onClick={() => flyDest(d)}>
                    <div className="nt-head">
                      <b>{L(d, 'name')}</b>
                      <span className="nt-units">{t('common.hkd')}{d.monthly_cost.toLocaleString()}</span>
                    </div>
                    <div className="nt-meta">
                      <span>{t('d.cost')}</span>
                      <span>{t('d.travel')} {d.travel_time_hr}{t('common.hours')}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          </>
        ) : (
          <Section title={t('sec.requests')}>
            <p className="section-sub">{t('req.intro')}</p>
            <RequestsList apps={apps} onPick={(a) => setOpenId(a.id)} />
          </Section>
        )}
      </div>
    </div>
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

function RequestsList({ apps, onPick }: {
  apps: Application[]; onPick: (a: Application) => void;
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
              className="req-row"
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

// ---------------------------------------------------------------- detail page

function CaseDetail({ app, onBack, onChanged, flyDest }: {
  app: Application; onBack: () => void; onChanged: () => Promise<void>;
  flyDest: (d: Destination) => void;
}) {
  const { t, L, lang } = useI18n();
  const [decisionNote, setDecisionNote] = useState(app.note ?? '');
  const [working, setWorking] = useState(false);
  const top = app.top_destination;
  const p = app.profile;
  const initials = (app.applicant_name || `#${app.id}`)
    .split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const score = top?.match ? Math.round(top.match.score) : null;
  const submittedDate = new Date(app.created_at).toLocaleDateString(
    lang === 'en' ? 'en-GB' : 'zh-HK',
    { day: '2-digit', month: 'short', year: 'numeric' },
  );

  const decide = async (decision: string) => {
    setWorking(true);
    try { await api.decide(app.id, decision, decisionNote); await onChanged(); }
    finally { setWorking(false); }
  };

  return (
    <>
      <div className="case-head">
        <button className="case-back" onClick={onBack}>
          <span aria-hidden>←</span> {t('detail.back')}
        </button>
      </div>

      <div className="panel-body case-body">
        {/* SUMMARY */}
        <div className="case-summary">
          <div className="case-avatar">{initials || '·'}</div>
          <div className="case-id">
            <div className="case-name-row">
              <h2>{app.applicant_name || `#${app.id}`}</h2>
              <span className={`badge badge-${app.status}`}>{t(`status.${app.status}`)}</span>
            </div>
            <div className="case-sub">
              #{app.id} · {t('detail.submittedOn')} {submittedDate}
            </div>
            <div className="case-flow">
              <span className="cf-from" title={app.origin_address || ''}>
                {app.origin_address || '–'}
              </span>
              <span className="cf-arrow">→</span>
              <button
                className="cf-to"
                onClick={() => top && flyDest(top as unknown as Destination)}>
                {top ? L(top, 'name') : '–'}
              </button>
            </div>
          </div>
          {score !== null && (
            <div className={`case-score-dial ${score >= 75 ? 'hi' : score >= 60 ? 'mid' : 'lo'}`}>
              <b>{score}</b>
              <small>{t('req.match')}</small>
            </div>
          )}
        </div>

        {/* TIMELINE */}
        <CaseFile app={app} onChanged={onChanged} />

        {/* PROFILE & MATCH */}
        <div className="case-section">
          <div className="case-section-head">{t('detail.profileMatch')}</div>
          <div className="case-section-body">
            <div className="kv"><span>{t('p.income')}</span>
              <b>{t('common.hkd')}{p.monthly_income?.toLocaleString() ?? '–'}{t('common.perMonth')}</b></div>
            <div className="kv"><span>{t('p.savings')}</span>
              <b>{t('common.hkd')}{p.savings?.toLocaleString() ?? '–'}</b></div>
            <div className="kv"><span>{t('p.stepFree')}</span>
              <b>{p.needs_step_free ? '✓' : '–'}</b></div>
            <div className="kv"><span>{t('p.careLevel')}</span>
              <b>{t(`care.${p.care_level ?? 0}`)}</b></div>
            {top?.match && (
              <div className="factors" style={{ marginTop: 14 }}>
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
            )}
          </div>
        </div>

        {/* DOCUMENTS */}
        <div className="case-section">
          <div className="case-section-head">
            {t('detail.docs')} <span className="case-count">{app.documents.length}</span>
          </div>
          <div className="case-section-body">
            {app.documents.length === 0
              ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('docs.none')}</div>
              : app.documents.map((d) => (
                <a className="doc" key={d.id} target="_blank" rel="noreferrer"
                  href={`/api/applications/${app.id}/documents/${d.id}`}>
                  <span>📄</span>
                  <span className="fname">{d.filename}</span>
                  <span style={{ color: 'var(--muted)' }}>{(d.size / 1024).toFixed(1)} KB</span>
                </a>
              ))}
          </div>
        </div>

        <div style={{ height: 90 }} />
      </div>

      {/* STICKY ACTION BAR */}
      <div className="case-actionbar">
        <input
          className="case-note-inline"
          type="text"
          value={decisionNote}
          onChange={(e) => setDecisionNote(e.target.value)}
          placeholder={t('apps.notePh')}
        />
        <div className="case-action-btns">
          <button className="btn" disabled={working} onClick={() => decide('under_review')}>
            {t('apps.review')}
          </button>
          <button className="btn btn-danger" disabled={working} onClick={() => decide('rejected')}>
            {t('apps.reject')}
          </button>
          <button className="btn btn-primary" disabled={working} onClick={() => decide('approved')}>
            {t('apps.approve')}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- timeline

const KIND_ICON: Record<CaseEventKind, string> = {
  note: '📝', contact: '📞', visit: '🏠', followup: '🔔',
  document: '📄', system: '⚙️', status: '🔁',
};

function relativeTime(iso: string, t: (k: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t('tl.justNow');
  if (m < 60) return `${m} ${t('tl.minAgo')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t('tl.hourAgo')}`;
  const d = Math.floor(h / 24);
  return `${d}${t('tl.dayAgo')}`;
}

function CaseFile({ app, onChanged }: {
  app: Application; onChanged: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<CaseEventKind>('note');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const COMPOSE_KINDS: CaseEventKind[] = ['note', 'contact', 'visit', 'followup'];

  const events = useMemo(
    () => [...(app.events ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [app.events],
  );

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    try {
      await api.addEvent(app.id, { kind, body: text });
      setBody('');
      await onChanged();
    } finally { setSaving(false); }
  };

  return (
    <div className="case-section case-section-prominent">
      <div className="case-section-head">
        {t('detail.casefile')} <span className="case-count">{events.length}</span>
      </div>
      <div className="case-section-body">
        <p className="section-sub" style={{ marginBottom: 12 }}>{t('tl.intro')}</p>

        {/* compose */}
        <div className="tl-compose">
          <div className="tl-kind-row">
            {COMPOSE_KINDS.map((k) => (
              <button key={k} type="button"
                className={`tl-kind-chip ${kind === k ? 'on' : ''}`}
                onClick={() => setKind(k)}>
                <span aria-hidden>{KIND_ICON[k]}</span>
                {t(`tl.kind.${k}`)}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('tl.compose.ph')}
            rows={2}
          />
          <div className="tl-compose-actions">
            <button className="btn btn-primary"
              onClick={submit}
              disabled={saving || !body.trim()}>
              {saving ? t('tl.saving') : t('tl.save')}
            </button>
          </div>
        </div>

        {/* timeline */}
        {events.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
            {t('tl.empty')}
          </div>
        ) : (
          <ul className="tl-list">
            {events.map((e: CaseEvent) => (
              <li key={e.id} className={`tl-item tl-${e.kind}`}>
                <div className="tl-dot" aria-hidden>{KIND_ICON[e.kind]}</div>
                <div className="tl-card">
                  <div className="tl-card-head">
                    <span className="tl-title">
                      {lang === 'en' ? e.title_en : e.title_tc}
                    </span>
                    <span className="tl-time" title={new Date(e.created_at).toLocaleString()}>
                      {relativeTime(e.created_at, t)}
                    </span>
                  </div>
                  {e.body && <p className="tl-body">{e.body}</p>}
                  <div className="tl-meta">
                    <span className={`tl-tag tl-tag-${e.kind}`}>{t(`tl.kind.${e.kind}`)}</span>
                    <span className="tl-author">{e.author}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
