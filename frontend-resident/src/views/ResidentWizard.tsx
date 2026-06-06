import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, ApiError, type Destination, type Profile } from '../api/client';
import type { MapState } from '../map/MapCanvas';
import { ScoreDial, FactorBars, ringClass } from '../components/MatchScore';
import { MatchDetails } from '../components/MatchDetails';
import { GovShell } from '../components/GovShell';

type StepKey = 'form' | 'results';

const PRIORITIES = ['family', 'cost', 'health', 'nature', 'community'] as const;
type Prio = (typeof PRIORITIES)[number];

const SPECIALTIES = ['medicine', 'orthopaedics', 'eye', 'ent', 'surgery', 'gynaecology', 'psychiatry'] as const;

/** Wizard answers → the backend ResidentProfile the new algorithm expects. */
function buildProfile(s: FormState): Profile {
  const has = (k: Prio) => s.prios.includes(k);
  return {
    monthly_income: s.income ?? 12000,
    savings: s.savings ?? 120000,
    oaa_oala_monthly: s.oala ? 4345 : 0,
    cssa_monthly: s.cssa ? 4500 : 0,
    has_hk_public_housing: s.publicHousing,
    is_chinese_pr: s.cpr,
    chronic_conditions: s.chronic,
    chronic_specialty: s.specialty,
    care_level: s.care ?? 1,
    needs_residential_care: s.residential,
    needs_step_free: s.stepFree ?? false,
    mobility_level: s.stepFree ? 2 : 1,
    family_in_hk: has('family') ? 0.9 : 0.5,
    pref_near_family: has('family') ? 1 : 0.4,
    pref_cantonese: has('community') ? 1 : 0.5,
    pref_green_space: has('nature') ? 1 : 0.4,
    pref_quiet: has('nature') ? 1 : 0.4,
    pref_community: has('community') ? 1 : 0.4,
  };
}

interface FormState {
  stepFree: boolean | null; care: number | null; prios: Prio[];
  income: number | null; savings: number | null;
  oala: boolean; cssa: boolean; publicHousing: boolean; cpr: boolean;
  chronic: number; specialty: string; residential: boolean;
}

export function ResidentWizard({ setView, onExit }: { setView: (v: MapState) => void; onExit: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<StepKey>('form');
  const [f, setF] = useState<FormState>({
    stepFree: null, care: null, prios: [],
    income: 12000, savings: 120000,
    oala: true, cssa: false, publicHousing: false, cpr: true,
    chronic: 0, specialty: 'medicine', residential: false,
  });
  const [ranked, setRanked] = useState<Destination[]>([]);
  const [choice, setChoice] = useState<Destination | null>(null);
  const [focus, setFocus] = useState<MapState['focus']>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const mapStage = step === 'results';

  useEffect(() => {
    if (step === 'results' && f.stepFree !== null && f.care !== null) {
      api.rank(buildProfile(f))
        .then((r) => { setRanked(r); setChoice((c) => c ?? r[0] ?? null); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    setView(mapStage
      ? { layer: 'destinations', metric: 'age', origin: null, footprintsBbox: null,
          destinations: ranked, selectedDestId: choice?.id ?? null, focus }
      : { layer: 'none', metric: 'age', origin: null, footprintsBbox: null,
          destinations: [], selectedDestId: null, focus: null });
  }, [mapStage, ranked, choice, focus, setView]);

  const canSubmitForm = f.stepFree !== null && f.care !== null
    && f.income !== null && f.savings !== null;
  const progress = step === 'form' ? 50 : 100;

  return (
    <GovShell chromeOnly crumbs={[
      t('nav.home'), t('nav.residents'),
      { label: t('nav.service'), onClick: onExit },
      t('nav.apply'),
    ]}>
      <div className="progress"><div className="fill" style={{ width: `${progress}%` }} /></div>

      {mapStage ? (
        <div className="map-panel">
          <ResultsPanel
            ranked={ranked} choice={choice} setChoice={setChoice}
            onFocusCity={(d) => setFocus({ center: [d.lng, d.lat], zoom: 9 })}
            profile={buildProfile(f)}
            onBack={() => { setFocus(null); setStep('form'); }} onExit={onExit}
          />
        </div>
      ) : (
        <div className="flow"><div className="flow-inner">{renderForm()}</div></div>
      )}
    </GovShell>
  );

  function renderForm(): ReactNode {
    return (
      <>
        <div>
          <div className="eyebrow">{t('app.title')} · {t('mode.resident')}</div>
          <h1 className="q-title">{t('flow.intro.title')}</h1>
          <p className="q-sub">{t('form.sub')}</p>
        </div>

        <div className="form-grid">
          {/* finances */}
          <section className="section">
            <h3>{t('q.income.title')}</h3>
            <p className="sub">{t('q.income.sub')}</p>
            <Slider value={f.income ?? 12000} min={0} max={30000} step={500}
              fmt={(v) => `${t('common.hkd')}${v.toLocaleString()}${v >= 30000 ? '+' : ''}${t('common.perMonth')}`}
              onChange={(v) => set('income', v)} />
          </section>

          <section className="section">
            <h3>{t('q.savings.title')}</h3>
            <p className="sub">{t('q.savings.sub')}</p>
            <Slider value={f.savings ?? 120000} min={0} max={1000000} step={10000}
              fmt={(v) => `${t('common.hkd')}${v.toLocaleString()}${v >= 1000000 ? '+' : ''}`}
              onChange={(v) => set('savings', v)} />
          </section>

          {/* benefits & status */}
          <section className="section">
            <h3>{t('q.benefits.title')}</h3>
            <p className="sub">{t('q.benefits.sub')}</p>
            <div className="toggles">
              <Toggle label={t('ben.oala')} on={f.oala} onClick={() => set('oala', !f.oala)} />
              <Toggle label={t('ben.cssa')} on={f.cssa} onClick={() => set('cssa', !f.cssa)} />
              <Toggle label={t('ben.publichousing')} on={f.publicHousing} onClick={() => set('publicHousing', !f.publicHousing)} />
              <Toggle label={t('ben.cpr')} on={f.cpr} onClick={() => set('cpr', !f.cpr)} />
            </div>
          </section>

          {/* mobility */}
          <section className="section">
            <h3>{t('q.stepfree.title')}</h3>
            <div className="options">
              <Opt title={t('opt.yes')} desc={t('opt.yes.d')} sel={f.stepFree === true} onClick={() => set('stepFree', true)} />
              <Opt title={t('opt.no')} desc={t('opt.no.d')} sel={f.stepFree === false} onClick={() => set('stepFree', false)} />
            </div>
          </section>

          {/* care & health */}
          <section className="section">
            <h3>{t('q.care.title')}</h3>
            <div className="options">
              {[0, 1, 2, 3].map((c) => (
                <Opt key={c} title={t(`care.${c}`)} desc={t(`care.${c}.d`)} sel={f.care === c} onClick={() => set('care', c)} />
              ))}
            </div>
            <div className="toggles" style={{ marginTop: 10 }}>
              <Toggle label={t('q.residential')} on={f.residential} onClick={() => set('residential', !f.residential)} />
            </div>
          </section>

          <section className="section">
            <h3>{t('q.chronic.title')}</h3>
            <p className="sub">{t('q.chronic.sub')}</p>
            <div className="options">
              {[0, 1, 2, 3].map((c) => (
                <Opt key={c} title={t(`chronic.${c}`)} sel={f.chronic === c} onClick={() => set('chronic', c)} />
              ))}
            </div>
            {f.chronic > 0 && (
              <div style={{ marginTop: 10 }}>
                <label className="sub" htmlFor="spec">{t('q.chronic.which')}</label>
                <select id="spec" className="select" value={f.specialty} onChange={(e) => set('specialty', e.target.value)}>
                  {SPECIALTIES.map((s) => <option key={s} value={s}>{t(`spec.${s}`)}</option>)}
                </select>
              </div>
            )}
          </section>

        </div>

        <div className="actions">
          <button className="btn btn-primary btn-lg grow" disabled={!canSubmitForm} onClick={() => setStep('results')}>
            {t('form.cta')} →
          </button>
        </div>
      </>
    );
  }
}

/* -------------------- shared bits -------------------- */
function Opt({ title, desc, sel, dim, onClick }: {
  title: string; desc?: string; sel: boolean; dim?: boolean; onClick: () => void;
}) {
  return (
    <button className={`opt ${sel ? 'sel' : ''}`} style={dim ? { opacity: 0.4 } : undefined} onClick={onClick}>
      <span style={{ flex: 1 }}>
        <span className="ttl" style={{ display: 'block' }}>{title}</span>
        {desc && <span className="desc" style={{ display: 'block' }}>{desc}</span>}
      </span>
    </button>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} type="button">
      <span className={`tg-box ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
      <span className="tg-label">{label}</span>
    </button>
  );
}

function Slider({ value, min, max, step, fmt, onChange }: {
  value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <div className="slider-val">{fmt(value)}</div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/* -------------------- results + submit (map stage) -------------------- */
function ResultsPanel({ ranked, choice, setChoice, onFocusCity, profile, onBack, onExit }: {
  ranked: Destination[]; choice: Destination | null; setChoice: (d: Destination) => void;
  onFocusCity: (d: Destination) => void; profile: Profile; onBack: () => void; onExit: () => void;
}) {
  const { t, L } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [appId, setAppId] = useState<number | null>(null);
  const [status, setStatus] = useState('submitted');
  const [note, setNote] = useState<string | null>(null);
  const persona = ranked[0]?.persona;

  const submit = async () => {
    if (!choice) return;
    setSubmitting(true);
    try {
      const ordered = [choice, ...ranked.filter((d) => d.id !== choice.id)];
      const res = await api.createApplication({ origin_address: '', profile, destinations: ordered });
      setAppId(res.id);
      setStatus('submitted');
    } catch (e) {
      // one application per resident — if the backend already has one, go to the dashboard
      if (e instanceof ApiError && e.status === 409) { onExit(); return; }
    } finally { setSubmitting(false); }
  };
  const refresh = async () => {
    if (appId == null) return;
    const a = await api.application(appId);
    setStatus(a.status); setNote(a.note);
  };

  if (appId != null) {
    return (
      <>
        <div className="body">
          <div className="done">
            <div className="check">✓</div>
            <h2 style={{ fontSize: 24 }}>{t('sub.done.title')}</h2>
            <p className="muted" style={{ marginTop: 8 }}>{t('sub.done.sub')}</p>
            <div style={{ marginTop: 14 }}>
              <span className={`badge badge-${status}`} style={{ fontSize: 14, padding: '8px 16px' }}>{t(`status.${status}`)}</span>
            </div>
            {note && <div className="optin" style={{ marginTop: 16, textAlign: 'left' }}><b>{t('sub.officerNote')}:</b>&nbsp;{note}</div>}
          </div>
        </div>
        <div className="foot">
          <div className="actions" style={{ margin: 0 }}>
            <button className="btn" onClick={refresh}>↻ {t('status.under_review')}</button>
            <button className="btn btn-primary grow" onClick={onExit}>{t('dash.backToList')}</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <h2>{t('results.title')}</h2>
        <p>{t('results.pins')}</p>
        {persona && <div className="persona-chip">{t('res.persona')}: <b>{t(`persona.${persona}`)}</b></div>}
      </div>
      <div className="body">
        {!ranked.length && <div className="center-msg">{t('common.loading')}</div>}
        {ranked.map((d, i) => {
          const sel = choice?.id === d.id;
          const open = openId === d.id;
          return (
            <div key={d.id} className={`dcard ${ringClass(d.match?.score ?? 0)} ${sel ? 'sel' : ''}`} onClick={() => { setChoice(d); onFocusCity(d); }}>
              <div className="rank">{i + 1}</div>
              <ScoreDial score={d.match?.score ?? 0} />
              <div className="info">
                <h4>{L(d, 'name')} <span className="sec">{L(d, 'name') === d.name_en ? d.name_tc : d.name_en}</span></h4>
                <div className="attrs">
                  <span className="save-pill">
                    {t('res.netSave')} <b>{`HK$${Math.round(d.net_savings_hkd ?? d.monthly_savings_hkd ?? 0).toLocaleString()}`}</b>{t('common.perMonth')}
                  </span>
                  <span>{t('d.travel')} <b>{d.travel_time_hr}{t('common.hours')}</b></span>
                </div>
                <button className="why" onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : d.id); }}>
                  {open ? t('res.detail') : t('rank.why')} {open ? '▲' : '▼'}
                </button>
                {open && d.match && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <FactorBars factors={d.match.factors} />
                    <MatchDetails d={d} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div className="seeded-note">{t('rank.seeded')}</div>
      </div>
      <div className="foot">
        {choice && (
          <div className="kv" style={{ borderBottom: 0, paddingTop: 0 }}>
            <span>{t('sub.firstChoice')}</span>
            <b>{L(choice, 'name')}{choice.match ? ` · ${Math.round(choice.match.score)}/100` : ''}</b>
          </div>
        )}
        <div className="actions" style={{ margin: 0 }}>
          <button className="btn" onClick={onBack}>←</button>
          <button className="btn btn-primary grow" disabled={submitting || !choice} onClick={submit}>
            {submitting ? t('sub.submitting') : t('sub.submit')}
          </button>
        </div>
      </div>
    </>
  );
}
