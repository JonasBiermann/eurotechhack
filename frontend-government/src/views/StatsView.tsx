import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type CaseEventKind, type Stats } from '../api/client';

const PIPELINE_ORDER = ['submitted', 'under_review', 'approved', 'rejected'] as const;

const KIND_ICON: Record<CaseEventKind, string> = {
  note: '📝', contact: '📞', visit: '🏠', followup: '🔔',
  document: '📄', system: '⚙️', status: '🔁',
};

function scoreClass(s: number) {
  return s >= 75 ? 'hi' : s >= 60 ? 'mid' : 'lo';
}

function fmt(n: number | null | undefined, fallback = '–') {
  return n != null ? String(n) : fallback;
}

function monthLabel(ym: string, lang: string) {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK', { month: 'short' });
}

export function StatsView() {
  const { t, lang } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setErr(true));
  }, []);

  if (err) return <div className="center-msg">Failed to load statistics.</div>;
  if (!stats) return <div className="center-msg">{t('common.loading')}</div>;
  if (stats.total === 0) return <div className="center-msg">{t('stats.nodata')}</div>;

  const maxPipe = Math.max(...Object.values(stats.by_status), 1);
  const maxDest = Math.max(...stats.by_destination.map((d) => d.count), 1);
  const maxCare = Math.max(...stats.by_care_level.map((c) => c.count), 1);
  const maxMonth = Math.max(...stats.by_month.map((m) => m.count), 1);

  const PIPE_META: Record<string, { label: string; cls: string }> = {
    submitted:    { label: t('req.new'),      cls: 'submitted'    },
    under_review: { label: t('req.review'),   cls: 'under_review' },
    approved:     { label: t('req.approved'), cls: 'approved'     },
    rejected:     { label: t('req.closed'),   cls: 'rejected'     },
  };

  const CARE_LABELS = [t('care.0'), t('care.1'), t('care.2'), t('care.3')];

  const activityKinds = useMemo(
    () => (Object.entries(stats.events_by_kind) as [CaseEventKind, number][])
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a),
    [stats.events_by_kind],
  );

  return (
    <>
      {/* ─── KPI HERO ─────────────────────────────────────── */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-num">{stats.total}</div>
          <div className="kpi-lbl">{t('stats.kpi.total')}</div>
        </div>

        <div className="kpi-card kpi-freed">
          <div className="kpi-freed-num">{stats.units_freed}</div>
          <div className="kpi-lbl">{t('stats.kpi.freed')}</div>
          <div className="kpi-sub">{t('stats.kpi.freed.sub')}</div>
        </div>

        <div className="kpi-card">
          <div className={`kpi-num kpi-score-${stats.avg_match_score != null ? scoreClass(stats.avg_match_score) : 'mid'}`}>
            {stats.avg_match_score != null ? Math.round(stats.avg_match_score) : '–'}
          </div>
          <div className="kpi-lbl">{t('stats.kpi.score')}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-num">
            {stats.avg_days_to_decision != null ? Math.round(stats.avg_days_to_decision) : '–'}
            {stats.avg_days_to_decision != null && <span className="kpi-unit">d</span>}
          </div>
          <div className="kpi-lbl">{t('stats.kpi.speed')}</div>
          {stats.approval_rate != null && (
            <div className="kpi-sub">{stats.approval_rate}% {t('stats.kpi.rate')}</div>
          )}
        </div>
      </div>

      {/* ─── HOUSING IMPACT BANNER ────────────────────────── */}
      <div className="impact-banner">
        <div className="impact-icon">🏘️</div>
        <div className="impact-body">
          <div className="impact-headline">
            <b>{stats.units_freed}</b>
            {' '}HK public housing unit{stats.units_freed !== 1 ? 's' : ''} freed for the waitlist
          </div>
          <div className="impact-sub">
            {stats.pending} application{stats.pending !== 1 ? 's' : ''} in progress
            {stats.approval_rate != null && ` · ${stats.approval_rate}% approval rate`}
          </div>
        </div>
      </div>

      {/* ─── PIPELINE ─────────────────────────────────────── */}
      <div className="stats-section">
        <div className="stats-section-head">
          {t('stats.pipeline.title')}
          <span className="stats-section-total">{stats.total} {t('stats.pipeline.total')}</span>
        </div>
        <div className="stats-section-body">
          <div className="pipeline">
            {PIPELINE_ORDER.map((key, i) => {
              const { label, cls } = PIPE_META[key];
              const count = stats.by_status[key] ?? 0;
              const pct = Math.round((count / maxPipe) * 100);
              return (
                <div key={key}>
                  {i === 2 && <div className="pipe-divider" />}
                  <div className="pipe-row">
                    <div className={`pipe-dot pipe-dot-${cls}`} />
                    <div className="pipe-label">{label}</div>
                    <div className="pipe-track">
                      <div className={`pipe-fill pipe-fill-${cls}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="pipe-count">{count}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── GBA DESTINATIONS ─────────────────────────────── */}
      <div className="stats-section">
        <div className="stats-section-head">{t('stats.dest.title')}</div>
        <div className="stats-section-body">
          <p className="stats-sub">{t('stats.dest.sub')}</p>
          <div className="dest-chart">
            {stats.by_destination.map((d) => {
              const pct = Math.round((d.count / maxDest) * 100);
              const sc = Math.round(d.avg_score);
              return (
                <div key={d.id} className="dest-row">
                  <div className="dest-name">{lang === 'en' ? d.name_en : d.name_tc}</div>
                  <div className="dest-track">
                    <div className="dest-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="dest-count">{d.count}</div>
                  <div className={`dest-score ${scoreClass(sc)}`}>{sc}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── RESIDENT PROFILES ────────────────────────────── */}
      <div className="stats-section">
        <div className="stats-section-head">{t('stats.care.title')}</div>
        <div className="stats-section-body">
          <p className="stats-sub">{t('stats.care.dist')}</p>
          <div className="care-chart">
            {stats.by_care_level.map((c) => {
              const pct = stats.total > 0 ? Math.round((c.count / stats.total) * 100) : 0;
              const barW = Math.round((c.count / maxCare) * 100);
              return (
                <div key={c.level} className="care-row">
                  <div className="care-lbl">{CARE_LABELS[c.level]}</div>
                  <div className="care-track">
                    <div className={`care-fill care-fill-${c.level}`} style={{ width: `${barW}%` }} />
                  </div>
                  <div className="care-right">
                    <span className="care-count">{c.count}</span>
                    <span className="care-pct">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* step-free demand */}
          <div className="stat-pill">
            <span className="stat-pill-label">♿ {t('stats.stepfree.label')}</span>
            <div className="stat-pill-track">
              <div className="stat-pill-fill" style={{ width: `${stats.step_free_pct}%` }} />
            </div>
            <span className="stat-pill-value">{stats.step_free_count}/{stats.total} · {stats.step_free_pct}%</span>
          </div>

          {/* avg income */}
          {stats.avg_income != null && (
            <div className="stat-pill">
              <span className="stat-pill-label">💰 {t('stats.avgincome.label')}</span>
              <span className="stat-pill-value stat-pill-value-solo">
                {t('common.hkd')}{stats.avg_income.toLocaleString()}{t('common.perMonth')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── MONTHLY VOLUME ───────────────────────────────── */}
      {stats.by_month.length > 0 && (
        <div className="stats-section">
          <div className="stats-section-head">{t('stats.monthly.title')}</div>
          <div className="stats-section-body">
            <div className="month-chart">
              {stats.by_month.map((m) => {
                const barH = Math.round((m.count / maxMonth) * 44);
                return (
                  <div key={m.month} className="month-col">
                    <div className="month-count">{m.count}</div>
                    <div className="month-bar" style={{ height: `${Math.max(barH, 4)}px` }} />
                    <div className="month-label">{monthLabel(m.month, lang)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── CASE ACTIVITY ────────────────────────────────── */}
      {activityKinds.length > 0 && (
        <div className="stats-section">
          <div className="stats-section-head">
            {t('stats.activity.title')}
            <span className="stats-section-total">{stats.total_events} {t('stats.activity.total')}</span>
          </div>
          <div className="stats-section-body">
            <div className="activity-grid">
              {activityKinds.map(([kind, n]) => (
                <div key={kind} className={`activity-chip activity-chip-${kind}`}>
                  <span className="activity-icon">{KIND_ICON[kind]}</span>
                  <span className="activity-count">{n}</span>
                  <span className="activity-lbl">{t(`tl.kind.${kind}`)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
