import { useI18n } from '../i18n/LanguageProvider';
import type { Destination, LedgerEntry, Provenance } from '../api/client';

const hkd = (n: number | null | undefined) =>
  n == null ? '—' : `HK$${Math.round(n).toLocaleString()}`;

/** Small honesty badge: real (live) / hardcoded (gov) / modeled. */
export function ProvenanceBadge({ kind }: { kind?: Provenance }) {
  const { t } = useI18n();
  if (!kind) return null;
  return <span className={`prov prov-${kind}`} title={t(`prov.${kind}.t`)}>{t(`prov.${kind}`)}</span>;
}

const STATUS_ORDER: LedgerEntry['status'][] = ['kept', 'gained', 'lost', 'at_risk', 'reduced'];

function LedgerRow({ e }: { e: LedgerEntry }) {
  const { t } = useI18n();
  return (
    <div className={`led-row led-${e.status}`}>
      <span className={`led-tag led-tag-${e.status}`}>{t(`led.${e.status}`)}</span>
      <div className="led-body">
        <div className="led-head">
          <span className="led-name">{e.name}</span>
          {e.monthly_value_hkd != null && (
            <span className="led-val">{hkd(e.monthly_value_hkd)}<small>/mo</small></span>
          )}
        </div>
        {e.condition && <div className="led-cond">{e.condition}</div>}
        <div className="led-src">
          <ProvenanceBadge kind={e.provenance} />
          <span className="muted">{t('led.source')}: {e.source}</span>
        </div>
      </div>
    </div>
  );
}

/** The full "why" panel for one matched city: projections + transparent benefits ledger. */
export function MatchDetails({ d }: { d: Destination }) {
  const { t } = useI18n();
  const prov = d.data_provenance || {};
  const ledger = [...(d.benefits_ledger || [])].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
  const pct = d.pct_income_freed != null ? Math.round(d.pct_income_freed * 100) : null;
  const net = d.net_savings_hkd ?? d.monthly_savings_hkd ?? 0;
  const positive = net > 0;

  return (
    <div className="mdetails">
      {/* headline: net savings + runway. When the city costs more than this senior's
          income can cover, we say so honestly instead of showing "negative savings". */}
      <div className="hero-save">
        <div className="hs-main">
          <span className="hs-label">{positive ? t('res.netSave') : t('res.shortfall')}</span>
          <span className="hs-amt">{hkd(Math.abs(net))}<small>/mo</small></span>
          {positive && pct != null
            ? <span className="hs-sub">{pct}% {t('res.ofIncome')}</span>
            : <span className="hs-sub warn">{t('res.shortfall.sub')}</span>}
          <ProvenanceBadge kind={prov.net_savings_hkd} />
        </div>
        <div className="hs-runway">
          {d.savings_sustainable
            ? <span className="ok">✓ {t('res.sustainable')}</span>
            : <span className="warn">{t('res.runway')} <b>{d.runway_years ?? '—'} {t('common.years')}</b></span>}
        </div>
      </div>

      {/* gross → lost → net breakdown */}
      <div className="proj-grid">
        <Stat label={t('res.gross')} value={hkd(d.gross_savings_hkd)} prov={prov.gross_savings_hkd} />
        <Stat label={t('res.lostBenefits')} value={`− ${hkd(d.lost_benefit_value_hkd)}`} prov={prov.lost_benefit_value_hkd} neg />
        <Stat label={t('res.net')} value={hkd(d.net_savings_hkd)} prov={prov.net_savings_hkd} strong />
      </div>

      {/* time-to-care */}
      <div className="proj-block">
        <div className="proj-title">{t('res.timecare')}</div>
        <div className="timecare">
          <span className="tc-hk">{t('res.hkwait')} <b>{d.time_to_care_hk_weeks}</b> {t('res.weeks')}
            <ProvenanceBadge kind={prov.time_to_care_hk_weeks} /></span>
          <span className="tc-arrow">→</span>
          <span className="tc-gba">{t('res.gbawait')} <b>{d.time_to_care_gba_weeks}</b> {t('res.weeks')}
            <ProvenanceBadge kind={prov.time_to_care_gba_weeks} /></span>
        </div>
        <div className="muted small">{t('res.seriousNote')}</div>
      </div>

      {/* returns + wellbeing */}
      <div className="proj-grid">
        <Stat label={t('res.returns')} value={`${d.return_trips_per_year ?? '—'}`} prov={prov.return_trips_per_year} />
        <Stat label={t('res.burden')} value={hkd(d.return_burden_hkd)} prov={prov.return_burden_hkd} />
        <Stat label={t('res.wellbeing')} value={`${d.projected_wellbeing ?? '—'}/100`} prov={prov.projected_wellbeing} />
      </div>

      {/* warnings */}
      {!!d.warnings?.length && (
        <div className="warns">
          <div className="proj-title">⚠ {t('res.warnings')}</div>
          <ul>{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {/* benefits ledger */}
      {!!ledger.length && (
        <div className="ledger">
          <div className="proj-title">{t('res.ledger')}</div>
          <div className="muted small">{t('res.ledgerSub')}</div>
          <div className="led-list">{ledger.map((e, i) => <LedgerRow key={i} e={e} />)}</div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, prov, strong, neg }: {
  label: string; value: string; prov?: Provenance; strong?: boolean; neg?: boolean;
}) {
  return (
    <div className={`pstat ${strong ? 'strong' : ''} ${neg ? 'neg' : ''}`}>
      <div className="ps-label">{label} <ProvenanceBadge kind={prov} /></div>
      <div className="ps-value">{value}</div>
    </div>
  );
}
