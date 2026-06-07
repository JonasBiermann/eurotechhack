import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, ApiError, type Destination, type Profile } from '../api/client';
import type { MapState } from '../map/MapCanvas';
import { ScoreDial, FactorBars, ringClass } from '../components/MatchScore';
import { MatchDetails } from '../components/MatchDetails';
import { GovShell } from '../components/GovShell';
import { SpeechAvatar } from '../components/SpeechAvatar';
import { useElevenLabs } from '../hooks/useElevenLabs';

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

// Step-by-step voice guidance. Each entry fires when the user first interacts with that section.
const VOICE_EN = 'yj30vwTGJxSHezdAGsv9';
const VOICE_ZH = 'n4xdXKggn5lFcXFYE4TA';

const GUIDE_STEPS: { fields: (keyof FormState)[]; en: string; zh: string }[] = [
  {
    fields: ['income'],
    en: "Let's start! Drag the slider to set your monthly income in Hong Kong dollars.",
    zh: '歡迎！請用滑動條設定您每月的收入。',
  },
  {
    fields: ['savings'],
    en: "Good. Now drag to enter your total savings — include bank deposits and your MPF balance.",
    zh: '好！請設定您的總儲蓄，包括銀行存款和強積金餘額。',
  },
  {
    fields: ['oala', 'cssa', 'publicHousing', 'cpr'],
    en: "Do you receive any government support? Tick everything that applies to you.",
    zh: '您有領取任何政府津貼嗎？請剔選所有適用的項目。',
  },
  {
    fields: ['stepFree'],
    en: "Do you need step-free access — lifts instead of stairs, ramps instead of steps?",
    zh: '您需要無障礙設施嗎？例如以升降機代替樓梯。',
  },
  {
    fields: ['care', 'residential'],
    en: "How much daily care support do you currently need? Be honest — we'll find cities with the right facilities.",
    zh: '您目前需要什麼程度的日常護理支援？請如實填寫。',
  },
  {
    fields: ['chronic', 'specialty'],
    en: "Do you have any ongoing health conditions? This helps us match you with cities that have the right medical specialists.",
    zh: '您有任何長期病患嗎？這有助我們為您配對合適的城市。',
  },
];
const GUIDE_READY = {
  en: "Perfect! You've answered everything. Tap the button below to see your personalised city matches.",
  zh: '完成！請按下方按鈕，查看最適合您的大灣區城市。',
};
const GUIDE_RESULTS = (city: string, score: number, zh: boolean) => zh
  ? `好消息！${city}是您的最佳配對，得分${score}分。請瀏覽列表，點擊城市了解詳情。`
  : `Great news! ${city} is your top match, scoring ${score} out of 100. Browse the list and tap any city to learn why it suits you.`;
const GUIDE_CITY = (city: string, save: number, zh: boolean) => zh
  ? `您選擇了${city}。每月可節省約港幣${save.toLocaleString()}元。準備好後請點擊「開始申請」。`
  : `You've selected ${city}. You could save around HK$${save.toLocaleString()} every month. Tap "Start My Application" when you're ready.`;

export function ResidentWizard({ setView, onExit }: { setView: (v: MapState) => void; onExit: (appId?: number) => void }) {
  const { t, lang } = useI18n();
  const langRef = useRef(lang);
  langRef.current = lang;
  const { speak, speaking, currentText, setMuted } = useElevenLabs(lang === 'zh' ? VOICE_ZH : VOICE_EN);
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
  const lastSpeakRef = useRef<() => void>(() => {});
  const guideStepRef = useRef(0);
  const [guideStep, setGuideStep] = useState(0);   // mirrors guideStepRef but triggers re-render
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent the city-description effect from speaking when choice is auto-set from rankings
  const choiceAutoRef = useRef(false);

  const say = (text: string) => {
    lastSpeakRef.current = () => speak(text);
    speak(text);
  };

  // Advance guidance when the user interacts with a field; debounce slider fields.
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((cur) => ({ ...cur, [k]: v }));

    const fieldStep = GUIDE_STEPS.findIndex((s) => s.fields.includes(k as keyof FormState));
    if (fieldStep < 0) return;

    const next = fieldStep + 1;
    // Allow next to equal GUIDE_STEPS.length (sentinel = "all done") but not exceed it
    if (next <= guideStepRef.current || next > GUIDE_STEPS.length) return;

    // Sliders fire on every tick — debounce so we only speak after the user stops dragging.
    const isSlider = k === 'income' || k === 'savings';
    const isFinalStep = next === GUIDE_STEPS.length;
    if (isSlider) {
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
      sliderTimerRef.current = setTimeout(() => {
        guideStepRef.current = next;
        setGuideStep(next);
        if (!isFinalStep) say(lang === 'zh' ? GUIDE_STEPS[next].zh : GUIDE_STEPS[next].en);
      }, 700);
    } else {
      guideStepRef.current = next;
      setGuideStep(next);
      if (!isFinalStep) say(lang === 'zh' ? GUIDE_STEPS[next].zh : GUIDE_STEPS[next].en);
    }
  };

  const mapStage = step === 'results';

  useEffect(() => {
    if (step === 'results' && f.stepFree !== null && f.care !== null) {
      api.rank(buildProfile(f))
        .then((r) => {
          setRanked(r);
          choiceAutoRef.current = true;  // suppress city-description speak for this auto-pick
          setChoice((c) => c ?? r[0] ?? null);
        })
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

  // Greet with step 0 on mount
  useEffect(() => {
    say(langRef.current === 'zh' ? GUIDE_STEPS[0].zh : GUIDE_STEPS[0].en);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "You're done — tap submit" — only after the user has completed all 6 sections
  useEffect(() => {
    if (guideStep === GUIDE_STEPS.length) {
      say(langRef.current === 'zh' ? GUIDE_READY.zh : GUIDE_READY.en);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideStep]);

  // Announce top result when rankings arrive
  useEffect(() => {
    if (!ranked.length) return;
    const top = ranked[0];
    say(GUIDE_RESULTS(top.name_en, Math.round(top.match?.score ?? 0), langRef.current === 'zh'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked]);

  // Describe selected city when user explicitly taps a different card (not auto-set)
  useEffect(() => {
    if (!choice) return;
    if (choiceAutoRef.current) { choiceAutoRef.current = false; return; }
    const save = Math.round(choice.net_savings_hkd ?? choice.monthly_savings_hkd ?? 0);
    say(GUIDE_CITY(choice.name_en, save, langRef.current === 'zh'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice?.id]);

  const canSubmitForm = f.stepFree !== null && f.care !== null
    && f.income !== null && f.savings !== null;
  const progress = step === 'form' ? 50 : 100;

  const makeAvatar = () => (
    <SpeechAvatar
      text={currentText}
      speaking={speaking}
      onReplay={() => lastSpeakRef.current()}
      onMuteChange={setMuted}
    />
  );

  const withBadge = (idx: number, content: ReactNode) => (
    <div style={{ position: 'relative', overflow: 'visible' }}>
      {content}
      {guideStep === idx && (
        <button
          key={idx}
          onClick={() => lastSpeakRef.current()}
          title="Replay"
          style={{
            position: 'absolute', top: '-18px', right: '-18px', zIndex: 30,
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--accent)', border: '3px solid #fff',
            boxShadow: '0 4px 16px rgba(214,32,42,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', animation: 'avatar-jump 0.35s cubic-bezier(0.36,0.07,0.19,0.97)',
          }}
        >
          {speaking && <span style={{
            position: 'absolute', inset: -5, borderRadius: '50%',
            border: '2.5px solid var(--accent)',
            animation: 'ring-pulse 1.6s ease-out infinite',
          }} />}
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="14" r="7" fill="white" fillOpacity="0.92" />
            <path d="M6 34c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );

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
            profile={buildProfile(f)} speaking={speaking} onReplay={() => lastSpeakRef.current()}
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
          {withBadge(0,
            <section className="section">
              <h3>{t('q.income.title')}</h3>
              <p className="sub">{t('q.income.sub')}</p>
              <Slider value={f.income ?? 12000} min={0} max={30000} step={500}
                fmt={(v) => `${t('common.hkd')}${v.toLocaleString()}${v >= 30000 ? '+' : ''}${t('common.perMonth')}`}
                onChange={(v) => set('income', v)} />
            </section>
          )}

          {withBadge(1,
            <section className="section">
              <h3>{t('q.savings.title')}</h3>
              <p className="sub">{t('q.savings.sub')}</p>
              <Slider value={f.savings ?? 120000} min={0} max={1000000} step={10000}
                fmt={(v) => `${t('common.hkd')}${v.toLocaleString()}${v >= 1000000 ? '+' : ''}`}
                onChange={(v) => set('savings', v)} />
            </section>
          )}

          {withBadge(2,
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
          )}

          {withBadge(3,
            <section className="section">
              <h3>{t('q.stepfree.title')}</h3>
              <div className="options">
                <Opt title={t('opt.yes')} desc={t('opt.yes.d')} sel={f.stepFree === true} onClick={() => set('stepFree', true)} />
                <Opt title={t('opt.no')} desc={t('opt.no.d')} sel={f.stepFree === false} onClick={() => set('stepFree', false)} />
              </div>
            </section>
          )}

          {withBadge(4,
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
          )}

          {withBadge(5,
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
          )}
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
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider">
      <div className="slider-val">{fmt(value)}</div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ ['--pct' as any]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/* -------------------- results + submit (map stage) -------------------- */
function ResultsPanel({ ranked, choice, setChoice, onFocusCity, profile, speaking, onReplay, onBack, onExit }: {
  ranked: Destination[]; choice: Destination | null; setChoice: (d: Destination) => void;
  onFocusCity: (d: Destination) => void; profile: Profile;
  speaking: boolean; onReplay: () => void;
  onBack: () => void; onExit: (appId?: number) => void;
}) {
  const { t, L } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const persona = ranked[0]?.persona;

  // Opening a city's full breakdown expands the panel to ~2/3 of the screen and
  // slides the map over to the left (driven by CSS off this body class).
  useEffect(() => {
    document.body.classList.toggle('panel-wide', openId !== null);
    return () => document.body.classList.remove('panel-wide');
  }, [openId]);

  const submit = async () => {
    if (!choice) return;
    setSubmitting(true);
    try {
      const ordered = [choice, ...ranked.filter((d) => d.id !== choice.id)];
      const res = await api.createApplication({ origin_address: '', profile, destinations: ordered });
      // The application starts in 'started' — the resident finishes it (documents +
      // truth declaration) from its overview, which we open directly.
      onExit(res.id);
    } catch (e) {
      // one application per resident — if the backend already has one, go to the dashboard
      if (e instanceof ApiError && e.status === 409) { onExit(); return; }
    } finally { setSubmitting(false); }
  };

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
            <div key={d.id} style={{ position: 'relative', overflow: 'visible' }}>
              {/* Avatar circle on the active card */}
              {sel && (
                <button key={d.id} onClick={onReplay} title="Replay"
                  style={{
                    position: 'absolute', top: -16, right: -16, zIndex: 30,
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'var(--accent)', border: '3px solid #fff',
                    boxShadow: '0 4px 16px rgba(214,32,42,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', animation: 'avatar-jump 0.35s cubic-bezier(0.36,0.07,0.19,0.97)',
                  }}>
                  {speaking && <span style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: '2px solid var(--accent)', animation: 'ring-pulse 1.6s ease-out infinite' }} />}
                  <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
                    <circle cx="20" cy="14" r="7" fill="white" fillOpacity="0.92" />
                    <path d="M6 34c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              {/* Tap hint on unselected cards */}
              {!sel && (
                <span style={{
                  position: 'absolute', top: 10, right: 12, zIndex: 10,
                  fontSize: 11, color: 'var(--muted)', fontWeight: 600,
                  letterSpacing: '0.03em', animation: 'tap-pulse 2s ease-in-out infinite',
                }}>tap to explore ↗</span>
              )}
            <div className={`dcard ${ringClass(d.match?.score ?? 0)} ${sel ? 'sel' : ''}`} onClick={() => { setChoice(d); onFocusCity(d); }}>
              <div className="rank">{i + 1}</div>
              <ScoreDial score={d.match?.score ?? 0} />
              <div className="info">
                <h4>{L(d, 'name')} <span className="sec">{L(d, 'name') === d.name_en ? d.name_tc : d.name_en}</span></h4>
                <div className="attrs">
                  <span className="save-pill">
                    {((d.net_savings_hkd ?? d.monthly_savings_hkd ?? 0) > 0)
                      ? <>{t('res.netSave')} <b>{`HK$${Math.round(d.net_savings_hkd ?? d.monthly_savings_hkd ?? 0).toLocaleString()}`}</b>{t('common.perMonth')}</>
                      : <>{t('res.shortfall')} <b>{`HK$${Math.abs(Math.round(d.net_savings_hkd ?? d.monthly_savings_hkd ?? 0)).toLocaleString()}`}</b>{t('common.perMonth')}</>}
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
            {submitting ? t('sub.submitting') : t('sub.start')}
          </button>
        </div>
      </div>
    </>
  );
}
