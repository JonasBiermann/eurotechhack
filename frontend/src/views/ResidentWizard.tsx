import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type BdRecord, type Destination, type Profile } from '../api/client';
import type { MapState } from '../map/MapCanvas';
import { ScoreDial, FactorBars } from '../components/MatchScore';

const STEPS = ['wiz.step.profile', 'wiz.step.rank', 'wiz.step.docs', 'wiz.step.submit'];
const DEFAULT_PROFILE: Profile = {
  monthly_income: 15000, savings: 200000, monthly_budget: 6000,
  needs_step_free: false, mobility_level: 1, care_level: 1, needs_clinic_nearby: true,
  pref_near_family: 0.6, pref_green_space: 0.5, pref_community: 0.6, pref_quiet: 0.5,
};

export function ResidentWizard({ setView }: { setView: (v: MapState) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [building, setBuilding] = useState<BdRecord | null>(null);
  const [ranked, setRanked] = useState<Destination[]>([]);
  const [choice, setChoice] = useState<Destination | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  // rank when entering step 1
  useEffect(() => {
    if (step === 1) {
      api.rank(profile).then((r) => { setRanked(r); setChoice((c) => c ?? r[0] ?? null); }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // drive the map
  useEffect(() => {
    if (step === 0) {
      const origin = building ? { lng: building.lng, lat: building.lat, label: building.address_en } : null;
      const bbox = building
        ? `${building.lng - 0.003},${building.lat - 0.0022},${building.lng + 0.003},${building.lat + 0.0022}`
        : null;
      setView({ layer: 'none', metric: 'age', origin, footprintsBbox: bbox, destinations: [],
        selectedDestId: null, focus: building ? { center: [building.lng, building.lat], zoom: 16 } : null });
    } else {
      const origin = building ? { lng: building.lng, lat: building.lat, label: building.address_en } : null;
      setView({ layer: 'destinations', metric: 'age', origin, footprintsBbox: null, destinations: ranked,
        selectedDestId: choice?.id ?? null, focus: choice ? { center: [choice.lng, choice.lat], zoom: 7 } : null });
    }
  }, [step, building, ranked, choice, setView]);

  return (
    <div className="panel panel-left">
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`st ${i === step ? 'active' : i < step ? 'done' : ''}`}>
            <div className="dot" />{t(s)}
          </div>
        ))}
      </div>
      <div className="panel-body">
        {step === 0 && <ProfileStep profile={profile} setProfile={setProfile} building={building} setBuilding={setBuilding} />}
        {step === 1 && <RankStep ranked={ranked} choice={choice} setChoice={setChoice} />}
        {step === 2 && <DocsStep files={files} setFiles={setFiles} />}
        {step === 3 && <SubmitStep profile={profile} building={building} choice={choice} ranked={ranked} files={files}
          onReset={() => { setStep(0); setProfile(DEFAULT_PROFILE); setBuilding(null); setRanked([]); setChoice(null); setFiles([]); }} />}

        <div className="btn-row" style={{ marginTop: 22 }}>
          {step > 0 && step < 3 && <button className="btn btn-lg" onClick={() => setStep(step - 1)}>{t('common.back')}</button>}
          {step < 2 && <button className="btn btn-primary btn-lg grow" disabled={step === 1 && !choice}
            onClick={() => setStep(step + 1)}>{t('common.next')}</button>}
          {step === 2 && <button className="btn btn-primary btn-lg grow" onClick={() => setStep(3)}>{t('common.next')}</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- small controls ---------------- */
function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>{label} <span className="val">{fmt(value)}</span></label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="switch" style={{ marginBottom: 12 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  );
}
function Chips({ label, value, options, onChange }: {
  label: string; value: number; options: string[]; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="chips">
        {options.map((o, i) => (
          <div key={i} className={`chip ${value === i ? 'on' : ''}`} onClick={() => onChange(i)}>{o}</div>
        ))}
      </div>
    </div>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <><div className="group-title">{title}</div>{children}</>;
}

/* ---------------- step 0: profile ---------------- */
function ProfileStep({ profile, setProfile, building, setBuilding }: {
  profile: Profile; setProfile: (p: Profile) => void; building: BdRecord | null; setBuilding: (b: BdRecord | null) => void;
}) {
  const { t, L } = useI18n();
  const set = (k: keyof Profile, v: any) => setProfile({ ...profile, [k]: v });
  const hk = (v: number) => `${t('common.hkd')}${v.toLocaleString()}`;

  const [q, setQ] = useState('');
  const [results, setResults] = useState<BdRecord[]>([]);
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const id = setTimeout(() => api.search(q).then((r) => { setResults(r); setSearched(true); }).catch(() => {}), 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div>
      <h2>{t('wiz.step.profile')}</h2>

      <Group title={t('p.finances')}>
        <Slider label={t('p.income')} value={profile.monthly_income!} min={4000} max={60000} step={1000}
          fmt={(v) => hk(v) + t('common.perMonth')} onChange={(v) => set('monthly_income', v)} />
        <Slider label={t('p.budget')} value={profile.monthly_budget!} min={2000} max={25000} step={500}
          fmt={(v) => hk(v) + t('common.perMonth')} onChange={(v) => set('monthly_budget', v)} />
        <Slider label={t('p.savings')} value={profile.savings!} min={0} max={2000000} step={50000}
          fmt={hk} onChange={(v) => set('savings', v)} />
      </Group>

      <Group title={t('p.mobility')}>
        <Toggle label={t('p.stepFree')} checked={!!profile.needs_step_free} onChange={(b) => set('needs_step_free', b)} />
        <Chips label={t('p.mobilityLevel')} value={profile.mobility_level!}
          options={[t('mob.0'), t('mob.1'), t('mob.2'), t('mob.3')]} onChange={(v) => set('mobility_level', v)} />
      </Group>

      <Group title={t('p.care')}>
        <Chips label={t('p.careLevel')} value={profile.care_level!}
          options={[t('care.0'), t('care.1'), t('care.2'), t('care.3')]} onChange={(v) => set('care_level', v)} />
        <Toggle label={t('p.clinic')} checked={!!profile.needs_clinic_nearby} onChange={(b) => set('needs_clinic_nearby', b)} />
      </Group>

      <Group title={t('p.lifestyle')}>
        {([['pref_near_family', 'p.nearFamily'], ['pref_green_space', 'p.green'],
           ['pref_community', 'p.community'], ['pref_quiet', 'p.quiet']] as const).map(([k, lbl]) => (
          <Slider key={k} label={t(lbl)} value={(profile as any)[k]} min={0} max={1} step={0.1}
            fmt={(v) => (v < 0.34 ? t('imp.low') : v > 0.66 ? t('imp.high') : '·')} onChange={(v) => set(k, v)} />
        ))}
      </Group>

      <Group title={t('p.currentBuilding')}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('p.searchPh')} />
        {!building && results.length > 0 && (
          <div className="search-results">
            {results.map((r) => (
              <button key={r.id} className="sresult" onClick={() => { setBuilding(r); setResults([]); setQ(L(r, 'address')); }}>
                {L(r, 'address')}<small>{L(r, 'district')} · {r.age_years ? `${r.age_years} ${t('common.years')}` : ''}</small>
              </button>
            ))}
          </div>
        )}
        {!building && searched && results.length === 0 && q.length >= 2 &&
          <div className="seeded-note">{t('p.noResults')}</div>}
        {building && <BuildingCard b={building} onClear={() => { setBuilding(null); setQ(''); setSearched(false); }} />}
      </Group>
    </div>
  );
}

function BuildingCard({ b, onClear }: { b: BdRecord; onClear: () => void }) {
  const { t, L } = useI18n();
  const noLift = b.no_lift === 1;
  return (
    <div className="bcard">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <h4>{L(b, 'address')}</h4>
        <button className="drawer-back" style={{ margin: 0 }} onClick={onClear}>✕</button>
      </div>
      <div className="meta">
        {b.op_year && <span className="tag">{t('p.builtIn')} {b.op_year}</span>}
        {b.age_years != null && <span className="tag">{b.age_years} {t('common.years')}</span>}
        {b.storeys_est != null && <span className="tag">{b.storeys_est} {t('p.storeys')}</span>}
        {L(b, 'usage') && <span className="tag">{L(b, 'usage')}</span>}
        {noLift ? <span className="tag warn">{t('p.noLiftWarn')}</span>
          : b.no_lift === 0 ? <span className="tag ok">{t('p.hasLift')}</span> : null}
      </div>
      {noLift && <div className="optin" style={{ marginTop: 12 }}>💡 {t('p.pushNote')}</div>}
    </div>
  );
}

/* ---------------- step 1: rank ---------------- */
function RankStep({ ranked, choice, setChoice }: {
  ranked: Destination[]; choice: Destination | null; setChoice: (d: Destination) => void;
}) {
  const { t, L } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!ranked.length) return <div className="center-msg">{t('common.loading')}</div>;
  return (
    <div>
      <h2>{t('rank.title')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 16px' }}>{t('rank.sub')}</p>
      {ranked.map((d, i) => {
        const sel = choice?.id === d.id;
        return (
          <div key={d.id} className={`dcard ${sel ? 'sel' : ''}`} onClick={() => setChoice(d)}>
            <ScoreDial score={d.match?.score ?? 0} />
            <div className="body">
              <h4>{i === 0 ? '★ ' : ''}{L(d, 'name')} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {L(d, 'name') === d.name_en ? d.name_tc : d.name_en}</span></h4>
              <div className="blurb">{L(d, 'blurb')}</div>
              <div className="attrs">
                <span>{t('d.cost')} <b>{t('common.hkd')}{d.monthly_cost.toLocaleString()}</b></span>
                <span>{t('d.travel')} <b>{d.travel_time_hr}{t('common.hours')}</b></span>
              </div>
              <button className="drawer-back" style={{ margin: '10px 0 0' }}
                onClick={(e) => { e.stopPropagation(); setOpenId(openId === d.id ? null : d.id); }}>
                {t('rank.why')} {openId === d.id ? '▲' : '▼'}
              </button>
              {openId === d.id && d.match && <FactorBars factors={d.match.factors} />}
            </div>
          </div>
        );
      })}
      <div className="seeded-note">{t('rank.seeded')}</div>
    </div>
  );
}

/* ---------------- step 2: documents ---------------- */
function DocsStep({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const { t } = useI18n();
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => { if (list) setFiles([...files, ...Array.from(list)]); };
  return (
    <div>
      <h2>{t('docs.title')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 16px' }}>{t('docs.sub')}</p>
      <label className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
        ⬆️ <div style={{ marginTop: 8 }}>{t('docs.drop')}</div>
        <input type="file" multiple style={{ display: 'none' }} onChange={(e) => add(e.target.files)} />
      </label>
      <div style={{ marginTop: 14 }}>
        {files.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('docs.none')}</div>}
        {files.map((f, i) => (
          <div className="doc" key={i}>
            <span>📄</span><span className="fname">{f.name}</span>
            <span style={{ color: 'var(--muted)' }}>{(f.size / 1024).toFixed(1)} KB</span>
            <button className="drawer-back" style={{ margin: 0 }}
              onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <div className="optin">🔒 {t('sub.opt.in')}</div>
    </div>
  );
}

/* ---------------- step 3: submit + track ---------------- */
function SubmitStep({ profile, building, choice, ranked, files, onReset }: {
  profile: Profile; building: BdRecord | null; choice: Destination | null;
  ranked: Destination[]; files: File[]; onReset: () => void;
}) {
  const { t, L, lang } = useI18n();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [appId, setAppId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('submitted');
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    if (!choice) return;
    setSubmitting(true);
    try {
      const ordered = [choice, ...ranked.filter((d) => d.id !== choice.id)];
      const res = await api.createApplication({
        applicant_name: name || (lang === 'en' ? 'Resident' : '居民'),
        origin_address: building ? building.address_en : '',
        profile, destinations: ordered,
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
      <div>
        <div className="done-hero">
          <div className="check">✓</div>
          <h2>{t('sub.done.title')}</h2>
          <p style={{ color: 'var(--muted)', marginTop: 6 }}>{t('sub.done.sub')}</p>
          <div style={{ marginTop: 14 }}><span className={`badge badge-${status}`} style={{ fontSize: 14, padding: '8px 16px' }}>{t(`status.${status}`)}</span></div>
        </div>
        {note && <div className="bcard"><b>{t('sub.officerNote')}</b><p style={{ marginTop: 6, color: 'var(--muted)' }}>{note}</p></div>}
        <div className="btn-row" style={{ marginTop: 18 }}>
          <button className="btn btn-lg grow" onClick={refresh}>↻ {t('status.under_review')}</button>
          <button className="btn btn-primary btn-lg grow" onClick={onReset}>{t('sub.another')}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>{t('sub.title')}</h2>
      <div className="field" style={{ marginTop: 14 }}>
        <label>{t('sub.name')}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sub.namePh')} />
      </div>
      {building && <div className="kv"><span>{t('apps.origin')}</span><b>{L(building, 'address')}</b></div>}
      <div className="kv"><span>{t('sub.firstChoice')}</span><b>{choice ? L(choice, 'name') : '–'}</b></div>
      <div className="kv"><span>{t('rank.title')}</span><b>{choice?.match ? `${Math.round(choice.match.score)}/100` : '–'}</b></div>
      <div className="kv"><span>{t('apps.docs')}</span><b>{files.length}</b></div>
      <div className="optin" style={{ marginTop: 14 }}>♥ {t('sub.opt.in')}</div>
      <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 18 }}
        disabled={submitting || !choice} onClick={submit}>
        {submitting ? t('sub.submitting') : t('sub.submit')}
      </button>
    </div>
  );
}
