import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type Destination, type Profile } from '../api/client';
import type { MapState } from '../map/MapCanvas';
import { ScoreDial, FactorBars } from '../components/MatchScore';

type StepKey = 'form' | 'results';

const PRIORITIES = ['family', 'cost', 'health', 'nature', 'community'] as const;
type Prio = (typeof PRIORITIES)[number];

function buildProfile(stepFree: boolean, care: number, prios: Prio[]): Profile {
  const p: Profile = {
    needs_step_free: stepFree, care_level: care, monthly_budget: 6000, needs_clinic_nearby: false,
    pref_near_family: 0.3, pref_green_space: 0.3, pref_community: 0.3, pref_quiet: 0.3,
  };
  for (const k of prios) {
    if (k === 'family') p.pref_near_family = 1;
    if (k === 'cost') p.monthly_budget = 3500;
    if (k === 'health') p.needs_clinic_nearby = true;
    if (k === 'nature') { p.pref_green_space = 1; p.pref_quiet = 1; }
    if (k === 'community') p.pref_community = 1;
  }
  return p;
}

export function ResidentWizard({ setView, onExit }: { setView: (v: MapState) => void; onExit: () => void }) {
  const { t, toggle } = useI18n();
  const [step, setStep] = useState<StepKey>('form');
  const [stepFree, setStepFree] = useState<boolean | null>(null);
  const [care, setCare] = useState<number | null>(null);
  const [prios, setPrios] = useState<Prio[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [ranked, setRanked] = useState<Destination[]>([]);
  const [choice, setChoice] = useState<Destination | null>(null);

  const mapStage = step === 'results';

  useEffect(() => {
    if (step === 'results' && stepFree !== null && care !== null) {
      api.rank(buildProfile(stepFree, care, prios))
        .then((r) => { setRanked(r); setChoice((c) => c ?? r[0] ?? null); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    setView(mapStage
      ? { layer: 'destinations', metric: 'age', origin: null, footprintsBbox: null,
          destinations: ranked, selectedDestId: choice?.id ?? null, focus: null }
      : { layer: 'none', metric: 'age', origin: null, footprintsBbox: null,
          destinations: [], selectedDestId: null, focus: null });
  }, [mapStage, ranked, choice, setView]);

  const togglePrio = (k: Prio) =>
    setPrios((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : cur.length < 2 ? [...cur, k] : cur);

  const canSubmitForm = stepFree !== null && care !== null && prios.length > 0;
  const progress = step === 'form' ? 50 : 100;

  return (
    <>
      <header className="topbar">
        <div className="brand"><div className="logo" /><b>{t('app.title')}</b><small>{t('app.tagline')}</small></div>
        <div className="spacer" />
        <button className="btn" onClick={onExit}>← {t('dash.backToList')}</button>
        <button className="lang-btn" onClick={toggle} title="EN / 繁體中文">{t('lang.name')}</button>
      </header>
      <div className="progress"><div className="fill" style={{ width: `${progress}%` }} /></div>

      {mapStage ? (
        <div className="map-panel">
          <ResultsPanel
            ranked={ranked} choice={choice} setChoice={setChoice}
            profile={buildProfile(stepFree!, care!, prios)} files={files}
            onBack={() => setStep('form')} onExit={onExit}
          />
        </div>
      ) : (
        <div className="flow"><div className="flow-inner">{renderForm()}</div></div>
      )}
    </>
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
          <section className="section">
            <h3>{t('q.stepfree.title')}</h3>
            <div className="options">
              <Opt title={t('opt.yes')} desc={t('opt.yes.d')} sel={stepFree === true} onClick={() => setStepFree(true)} />
              <Opt title={t('opt.no')} desc={t('opt.no.d')} sel={stepFree === false} onClick={() => setStepFree(false)} />
            </div>
          </section>

          <section className="section">
            <h3>{t('q.care.title')}</h3>
            <div className="options">
              {[0, 1, 2, 3].map((c) => (
                <Opt key={c} title={t(`care.${c}`)} desc={t(`care.${c}.d`)} sel={care === c} onClick={() => setCare(c)} />
              ))}
            </div>
          </section>

          <section className="section">
            <h3>{t('q.prio.title')}</h3>
            <p className="sub">{t('q.prio.sub')}</p>
            <div className="options">
              {PRIORITIES.map((k) => {
                const sel = prios.includes(k);
                const dim = !sel && prios.length >= 2;
                return <Opt key={k} title={t(`prio.${k}`)} sel={sel} dim={dim} onClick={() => !dim && togglePrio(k)} />;
              })}
            </div>
          </section>

          <section className="section">
            <h3>{t('docs.title')}</h3>
            <p className="sub">{t('docs.sub')}</p>
            <Dropzone files={files} setFiles={setFiles} />
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

/* -------------------- document dropzone -------------------- */
function Dropzone({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const { t } = useI18n();
  const [drag, setDrag] = useState(false);
  const add = (l: FileList | null) => { if (l) setFiles([...files, ...Array.from(l)]); };
  return (
    <>
      <label className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
        <div>{t('docs.drop')}</div>
        <input type="file" multiple style={{ display: 'none' }} onChange={(e) => add(e.target.files)} />
      </label>
      {files.length === 0
        ? <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>{t('docs.none')}</div>
        : files.map((f, i) => (
          <div className="doc" key={i}>
            <span className="fname">{f.name}</span>
            <span className="muted">{(f.size / 1024).toFixed(1)} KB</span>
            <button className="x" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
    </>
  );
}

/* -------------------- results + submit (map stage) -------------------- */
function ResultsPanel({ ranked, choice, setChoice, profile, files, onBack, onExit }: {
  ranked: Destination[]; choice: Destination | null; setChoice: (d: Destination) => void;
  profile: Profile; files: File[]; onBack: () => void; onExit: () => void;
}) {
  const { t, L } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [appId, setAppId] = useState<number | null>(null);
  const [status, setStatus] = useState('submitted');
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    if (!choice) return;
    setSubmitting(true);
    try {
      const ordered = [choice, ...ranked.filter((d) => d.id !== choice.id)];
      const res = await api.createApplication({
        origin_address: '', profile, destinations: ordered,
      });
      setAppId(res.id);
      for (const f of files) { try { await api.uploadDocument(res.id, f); } catch { /* ignore */ } }
      setStatus('submitted');
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
      <div className="head"><h2>{t('results.title')}</h2><p>{t('results.pins')}</p></div>
      <div className="body">
        {!ranked.length && <div className="center-msg">{t('common.loading')}</div>}
        {ranked.map((d, i) => {
          const sel = choice?.id === d.id;
          return (
            <div key={d.id} className={`dcard ${sel ? 'sel' : ''}`} onClick={() => setChoice(d)}>
              <div className="rank">{i + 1}</div>
              <ScoreDial score={d.match?.score ?? 0} />
              <div className="info">
                <h4>{L(d, 'name')} <span className="sec">{L(d, 'name') === d.name_en ? d.name_tc : d.name_en}</span></h4>
                <div className="attrs">
                  <span>{t('d.cost')} <b>{t('common.hkd')}{d.monthly_cost.toLocaleString()}</b></span>
                  <span>{t('d.travel')} <b>{d.travel_time_hr}{t('common.hours')}</b></span>
                </div>
                <button className="why" onClick={(e) => { e.stopPropagation(); setOpenId(openId === d.id ? null : d.id); }}>
                  {t('rank.why')} {openId === d.id ? '▲' : '▼'}
                </button>
                {openId === d.id && d.match && <FactorBars factors={d.match.factors} />}
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
