import { useI18n } from '../i18n/LanguageProvider';
import { api, type Application, type Destination } from '../api/client';
import { Dropzone } from './Dropzone';

/* Post-approval guidance: a clear, sequenced "first steps in <City>" checklist,
   plus the proof-of-move upload that an officer later confirms. City-specific
   details (designated hospital, control point) come from the matched destination. */

type Step = { t: string; d: string; extra?: string | null; cta?: boolean };

export function NextSteps({ app, dest, onUploadProof, onOpenPermits }: {
  app: Application;
  dest: Destination | null;
  onUploadProof: (files: File[]) => void;
  onOpenPermits: () => void;
}) {
  const { t, L } = useI18n();
  const city = dest ? L(dest, 'name') : '';
  const moved = app.status === 'moved';

  const steps: Step[] = [
    { t: t('ns.s1.t'), d: t('ns.s1.d'), cta: true },
    { t: t('ns.s2.t'), d: t('ns.s2.d') },
    { t: t('ns.s3.t'), d: t('ns.s3.d'), cta: true },
    { t: t('ns.s4.t'), d: t('ns.s4.d'), extra: dest?.ehcv_institution || null },
    { t: t('ns.s5.t'), d: t('ns.s5.d') },
    { t: t('ns.s6.t'), d: t('ns.s6.d') },
    {
      t: t('ns.s7.t'),
      d: t('ns.s7.d'),
      extra: dest?.control_point
        ? `${dest.control_point}${dest.border_travel_hr ? ` · ~${dest.border_travel_hr}${t('common.hours')}` : ''}`
        : null,
    },
    { t: t('ns.s8.t'), d: t('ns.s8.d') },
  ];

  return (
    <>
      <h2 className="gov-sec-title">{t('ns.title')}{city ? ` ${city}` : ''}</h2>
      <section className="section">
        <p className="sub" style={{ marginTop: 0 }}>{moved ? t('ns.sub.moved') : t('ns.sub')}</p>
        <div className="todo-list" style={{ marginTop: 12 }}>
          {steps.map((s, i) => (
            <div className="todo-item" key={i}>
              <span className="todo-box" style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>{i + 1}</span>
              <div className="todo-text">
                <span className="todo-label">{s.t}</span>
                <span className="todo-desc">
                  {s.d}{s.extra ? <> — <b>{s.extra}</b></> : null}
                </span>
              </div>
              {s.cta && (
                <button className="btn" style={{ flex: 'none' }} onClick={onOpenPermits}>{t('ns.openPermits')}</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* proof of move: upload → officer confirms → "settled" */}
      <h2 className="gov-sec-title">{t('ns.proof.title')}</h2>
      <section className="section">
        {moved ? (
          <div className="declare-box" style={{ textAlign: 'center' }}>
            <div className="todo-box" style={{ margin: '0 auto 8px', width: 34, height: 34, background: 'var(--ok)', borderColor: 'var(--ok)', fontSize: 18 }}>✓</div>
            <h3 className="prose-h" style={{ margin: 0 }}>{t('ns.settled.title')}{city ? ` ${city}` : ''}</h3>
            <p className="prose-p" style={{ marginTop: 6 }}>{t('ns.settled.sub')}</p>
          </div>
        ) : app.proof_pending ? (
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>⏳ {t('ns.proof.pending')}</p>
        ) : (
          <>
            <p className="sub" style={{ marginTop: 0 }}>{t('ns.proof.sub')}</p>
            <Dropzone onFiles={onUploadProof} />
          </>
        )}
      </section>
    </>
  );
}
