import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type AllowanceScheme, type PermitApplication } from '../api/client';
import { GovShell } from '../components/GovShell';

/* ---------------------------------------------------------------------------
   Guangdong Scheme Allowance — eligibility rules (single applicant).
   Figures are gov-sourced demo values; adjust here if the official rates change.
   OAA  : age 70+, non-means-tested.
   OALA : age 65+, means-tested (monthly income + total assets within limits).
   A person may receive ONLY ONE of the two — never both at the same time.
--------------------------------------------------------------------------- */
const AGE_OAA = 70;
const AGE_OALA = 65;
const OAA_AMOUNT = 1620;            // HK$/month
const OALA_AMOUNT = 4195;           // HK$/month
const OALA_INCOME_LIMIT = 10710;    // HK$/month (single)
const OALA_ASSET_LIMIT = 402000;    // HK$ (single)

const hkd = (n: number) => `HK$${Math.round(n).toLocaleString()}`;

export function PermitsPage({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [permits, setPermits] = useState<PermitApplication[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = () => api.myPermits().then(setPermits).catch(() => setPermits([]));
  useEffect(() => { load(); }, []);

  const onSubmitted = (msg: string) => { setFlash(msg); load(); };

  return (
    <GovShell crumbs={[t('nav.home'), t('nav.residents'),
      { label: t('nav.service'), onClick: onBack }, t('tile.permits')]}>
      <div className="gov-content">
        <button className="btn" onClick={onBack}>← {t('page.back')}</button>
        <section className="gov-hero" style={{ marginTop: 16 }}>
          <div>
            <h1>{t('permits.title')}</h1>
            <p>{t('permits.sub')}</p>
          </div>
        </section>

        {flash && <div className="flash-ok">✓ {flash}</div>}

        <h2 className="gov-sec-title">{t('permit.kind.home_return_permit')}</h2>
        <HomeReturnForm onSubmitted={() => onSubmitted(t('permits.flash.permit'))} />

        <h2 className="gov-sec-title">{t('permit.kind.guangdong_allowance')}</h2>
        <AllowanceForm onSubmitted={() => onSubmitted(t('permits.flash.allowance'))} />

        <h2 className="gov-sec-title">{t('permits.mine')}</h2>
        <div className="gov-applist">
          {permits === null && <div className="center-msg">{t('common.loading')}</div>}
          {permits !== null && permits.length === 0 && (
            <div className="applist-empty">{t('permits.none')}</div>
          )}
          {permits?.map((p) => (
            <div key={p.id} className="dcard" style={{ cursor: 'default' }}>
              <div className="info">
                <h4>{t(`permit.kind.${p.kind}`)}{p.scheme ? ` · ${t(`ga.${p.scheme}.name`)}` : ''}</h4>
                <div className="attrs">
                  <span>{t('permits.ref')} <b>#{p.id}</b></span>
                </div>
              </div>
              <span className={`badge badge-${p.status}`}>{t(`status.${p.status}`)}</span>
            </div>
          ))}
        </div>
      </div>
    </GovShell>
  );
}

/* -------------------------- Home Return Permit -------------------------- */
function HomeReturnForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { t } = useI18n();
  const [chineseName, setChineseName] = useState('');
  const [dob, setDob] = useState('');
  const [locality, setLocality] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = chineseName.trim() && dob && locality.trim();
  const submit = async () => {
    setBusy(true);
    try {
      await api.createPermit({ kind: 'home_return_permit',
        details: { chinese_name: chineseName.trim(), dob, return_locality: locality.trim(), contact: contact.trim() } });
      setChineseName(''); setDob(''); setLocality(''); setContact('');
      onSubmitted();
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <section className="section">
      <p className="sub">{t('hrp.sub')}</p>
      <div className="form-grid" style={{ marginTop: 4 }}>
        <Field label={t('hrp.name')}>
          <input type="text" value={chineseName} onChange={(e) => setChineseName(e.target.value)} placeholder={t('hrp.name.ph')} />
        </Field>
        <Field label={t('hrp.dob')}>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </Field>
        <Field label={t('hrp.locality')}>
          <input type="text" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder={t('hrp.locality.ph')} />
        </Field>
        <Field label={`${t('hrp.contact')} (${t('common.optional')})`}>
          <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('hrp.contact.ph')} />
        </Field>
      </div>
      <div className="actions">
        <button className="btn btn-primary grow" disabled={!valid || busy} onClick={submit}>
          {busy ? t('sub.submitting') : t('permits.apply')}
        </button>
      </div>
    </section>
  );
}

/* ---------------- Guangdong Scheme Allowance (airtight OAA/OALA) ---------------- */
function AllowanceForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { t } = useI18n();
  const [age, setAge] = useState('');
  const [income, setIncome] = useState('');
  const [assets, setAssets] = useState('');
  const [scheme, setScheme] = useState<AllowanceScheme | null>(null);
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);

  const ageN = Number(age) || 0;
  const incomeN = Number(income) || 0;
  const assetsN = Number(assets) || 0;
  const entered = age !== '';

  const oaaEligible = ageN >= AGE_OAA;
  const oalaEligible = ageN >= AGE_OALA && incomeN <= OALA_INCOME_LIMIT && assetsN <= OALA_ASSET_LIMIT;

  const oaaReason = oaaEligible ? null : t('ga.oaa.reqAge');
  const oalaReason = oalaEligible ? null
    : ageN < AGE_OALA ? t('ga.oala.reqAge')
    : incomeN > OALA_INCOME_LIMIT ? t('ga.oala.overIncome')
    : assetsN > OALA_ASSET_LIMIT ? t('ga.oala.overAssets')
    : t('ga.oala.req');

  // Drop a selection that is no longer eligible after the inputs changed.
  useEffect(() => {
    if (scheme === 'oaa' && !oaaEligible) setScheme(null);
    if (scheme === 'oala' && !oalaEligible) setScheme(null);
  }, [scheme, oaaEligible, oalaEligible]);

  const validSelection = (scheme === 'oaa' && oaaEligible) || (scheme === 'oala' && oalaEligible);
  const canSubmit = entered && validSelection && declared && !busy;

  const submit = async () => {
    if (!scheme || !validSelection) return;
    setBusy(true);
    try {
      await api.createPermit({ kind: 'guangdong_allowance', scheme,
        details: { age: ageN, monthly_income: incomeN, total_assets: assetsN } });
      setAge(''); setIncome(''); setAssets(''); setScheme(null); setDeclared(false);
      onSubmitted();
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <section className="section">
      <p className="sub">{t('ga.sub')}</p>

      <div className="form-grid" style={{ marginTop: 4 }}>
        <Field label={t('ga.age')}>
          <input type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} placeholder="—" />
        </Field>
        <Field label={`${t('ga.income')} (${t('common.hkd')}${t('common.perMonth')})`}>
          <input type="number" min={0} value={income} onChange={(e) => setIncome(e.target.value)} placeholder="0" />
        </Field>
        <Field label={`${t('ga.assets')} (${t('common.hkd')})`}>
          <input type="number" min={0} value={assets} onChange={(e) => setAssets(e.target.value)} placeholder="0" />
        </Field>
      </div>

      <p className="sub" style={{ marginTop: 14 }}>{t('ga.choose')}</p>
      <div className="options">
        <SchemeOpt
          name={t('ga.oaa.name')} amount={hkd(OAA_AMOUNT)} per={t('common.perMonth')}
          note={t('ga.oaa.note')} reason={oaaReason}
          eligible={oaaEligible} disabled={!entered}
          sel={scheme === 'oaa'} onClick={() => oaaEligible && setScheme('oaa')} />
        <SchemeOpt
          name={t('ga.oala.name')} amount={hkd(OALA_AMOUNT)} per={t('common.perMonth')}
          note={t('ga.oala.note')} reason={oalaReason}
          eligible={oalaEligible} disabled={!entered}
          sel={scheme === 'oala'} onClick={() => oalaEligible && setScheme('oala')} />
      </div>
      <div className="optin" style={{ textAlign: 'left' }}>{t('ga.exclusive')}</div>

      <button type="button" className={`toggle ${declared ? 'on' : ''}`}
        style={{ marginTop: 12, alignItems: 'flex-start' }} onClick={() => setDeclared((v) => !v)}>
        <span className={`tg-box ${declared ? 'on' : ''}`}>{declared ? '✓' : ''}</span>
        <span className="tg-label">{t('ga.declare')}</span>
      </button>

      <div className="actions">
        <button className="btn btn-primary grow" disabled={!canSubmit} onClick={submit}>
          {busy ? t('sub.submitting') : t('permits.apply')}
        </button>
      </div>
    </section>
  );
}

function SchemeOpt({ name, amount, per, note, reason, eligible, disabled, sel, onClick }: {
  name: string; amount: string; per: string; note: string; reason: string | null;
  eligible: boolean; disabled: boolean; sel: boolean; onClick: () => void;
}) {
  const blocked = disabled || !eligible;
  return (
    <button type="button" className={`opt ${sel ? 'sel' : ''}`} onClick={onClick}
      disabled={blocked} style={blocked ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <span style={{ flex: 1 }}>
        <span className="ttl" style={{ display: 'block' }}>{name} · <span style={{ color: 'var(--accent-press)' }}>{amount}{per}</span></span>
        <span className="desc" style={{ display: 'block' }}>{note}</span>
        {!disabled && reason && <span className="desc" style={{ display: 'block', color: 'var(--bad)', marginTop: 2 }}>✕ {reason}</span>}
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
