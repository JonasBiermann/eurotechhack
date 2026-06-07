import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type Application, type Cohort } from '../api/client';

/* Same-city community ("you won't arrive alone"). Opt-in connects the resident to
   others relocating to the same GBA city; a named HK Social Welfare Department
   caseworker mediates introductions — we deliberately do NOT run an open chat. */

export function CohortCard({ app }: { app: Application }) {
  const { t, lang } = useI18n();
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.myCohort().then(setCohort).catch(() => setCohort(null));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [app.id, app.status]);

  if (!cohort || !cohort.has_destination) return null;

  const city = lang === 'zh' ? cohort.name_tc : cohort.name_en;
  const cw = cohort.caseworker;
  const cwName = cw ? (lang === 'zh' ? cw.name_tc : cw.name_en) : '';
  const cwOffice = cw ? (lang === 'zh' ? cw.office_tc : cw.office_en) : '';
  const others = cohort.others ?? 0;

  const toggle = async () => {
    setBusy(true);
    try { await api.setCohortOptin(app.id, !cohort.opted_in); await load(); }
    catch { /* ignore */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="gov-sec-title">{t('cohort.title')}</h2>

      {!cohort.opted_in ? (
        /* ---- invitation to join ---- */
        <section className="section cohort-invite">
          <div className="cohort-headline">
            {others > 0
              ? t('cohort.invite.count').replace('{n}', String(others)).replace('{city}', city || '')
              : t('cohort.invite.first').replace('{city}', city || '')}
          </div>
          <p className="sub" style={{ marginTop: 6 }}>{t('cohort.invite.sub')}</p>
          <button className="btn btn-primary" disabled={busy} onClick={toggle} style={{ marginTop: 12 }}>
            {busy ? '…' : t('cohort.join')}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t('cohort.privacy')}</p>
        </section>
      ) : (
        /* ---- joined: cohort overview ---- */
        <section className="section">
          <div className="cohort-headline">
            {others > 0
              ? t('cohort.joined.count').replace('{n}', String(others)).replace('{city}', city || '')
              : t('cohort.joined.first').replace('{city}', city || '')}
          </div>

          {(cohort.in_window || cohort.moved) ? (
            <div className="cohort-stats">
              {!!cohort.in_window && (
                <span className="cohort-pill">
                  <b>{cohort.in_window}</b> {t('cohort.stat.window')}
                </span>
              )}
              {!!cohort.moved && (
                <span className="cohort-pill ok">
                  <b>{cohort.moved}</b> {t('cohort.stat.moved')}
                </span>
              )}
            </div>
          ) : null}

          {/* shared logistics */}
          {(cohort.control_point || cohort.ehcv_institution) && (
            <div className="cohort-shared">
              {cohort.control_point && (
                <div className="kv">
                  <span>{t('cohort.shared.crossing')}</span>
                  <b>{cohort.control_point}{cohort.border_travel_hr ? ` · ~${cohort.border_travel_hr}${t('common.hours')}` : ''}</b>
                </div>
              )}
              {cohort.ehcv_institution && (
                <div className="kv">
                  <span>{t('cohort.shared.hospital')}</span>
                  <b>{cohort.ehcv_institution}</b>
                </div>
              )}
            </div>
          )}

          {/* peers */}
          {!!cohort.peers?.length && (
            <div className="cohort-peers">
              {cohort.peers.map((p, i) => (
                <span key={i} className="cohort-peer">
                  <span className="cohort-peer-dot" />{p.name}
                  {p.status === 'moved' && <span className="cohort-peer-tag">{t('cohort.peer.settled')}</span>}
                </span>
              ))}
            </div>
          )}

          {/* caseworker contact */}
          {cw && (
            <div className="cohort-caseworker">
              <div className="cw-avatar">{cwName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\s+/, '').charAt(0)}</div>
              <div className="cw-info">
                <div className="cw-name">{cwName}</div>
                <div className="cw-office">{cwOffice}</div>
              </div>
              <a className="btn btn-primary" href={`tel:${cw.phone.replace(/\s/g, '')}`}>
                {t('cohort.contact')}
              </a>
            </div>
          )}

          <button className="linkbtn" disabled={busy} onClick={toggle} style={{ marginTop: 8 }}>
            {t('cohort.leave')}
          </button>
        </section>
      )}
    </>
  );
}
