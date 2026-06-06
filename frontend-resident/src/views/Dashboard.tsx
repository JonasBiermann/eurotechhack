import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type Application } from '../api/client';
import { GovShell } from '../components/GovShell';
import { Dropzone } from '../components/Dropzone';
import { ScoreDial, ringClass } from '../components/MatchScore';

/* simple inline line-icons (no emoji) */
const Icon = {
  apply: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 18v-6M9 15h6"/></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/></svg>,
  guide: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h7M8 11h7"/></svg>,
  elderly: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="6" r="3"/><path d="M9 21v-5l-2-2 1-5h6l1 5-2 2v5"/></svg>,
};

export function Dashboard({ onNew }: { onNew: () => void }) {
  const { t, L, lang } = useI18n();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = () => api.myApplications().then(setApps).catch(() => setApps([]));
  useEffect(() => { load(); }, []);
  const upload = async (id: number, files: File[]) => {
    for (const f of files) { try { await api.uploadDocument(id, f); } catch { /* ignore */ } }
    load();
  };

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK'); }
    catch { return iso?.slice(0, 10) ?? ''; }
  };
  const scrollToList = () => listRef.current?.scrollIntoView({ behavior: 'smooth' });

  const selected = apps?.find((a) => a.id === selectedId) ?? null;

  // ---------- application detail ----------
  if (selected) {
    const a = selected;
    const top = a.top_destination;
    return (
      <GovShell crumbs={[t('nav.home'), t('nav.residents'),
        { label: t('nav.service'), onClick: () => setSelectedId(null) },
        `${t('dash.app')} #${a.id}`]}>
        <div className="gov-content">
          <button className="btn" onClick={() => setSelectedId(null)}>← {t('dash.backToList')}</button>

          <h2 className="gov-sec-title" style={{ marginTop: 16 }}>{t('dash.app')} #{a.id}</h2>
          <section className="section">
            <div className="kv"><span>{t('app.status')}</span><b><span className={`badge badge-${a.status}`}>{t(`status.${a.status}`)}</span></b></div>
            <div className="kv"><span>{t('dash.submitted_on')}</span><b>{fmtDate(a.created_at)}</b></div>
            <div className="kv"><span>{t('sub.firstChoice')}</span><b>{top ? L(top, 'name') : '–'}</b></div>
            <div className="kv" style={{ borderBottom: 0 }}><span>{t('app.matchscore')}</span><b>{top?.match ? `${Math.round(top.match.score)}/100` : '–'}</b></div>
            {a.note && <div className="optin" style={{ textAlign: 'left' }}><b>{t('sub.officerNote')}:</b>&nbsp;{a.note}</div>}
          </section>

          {a.status === 'approved' && (
            <>
              <h2 className="gov-sec-title">{t('dash.upload.title')}</h2>
              <section className="section">
                <p className="sub">{t('dash.upload.sub')}</p>
                {a.documents.length > 0
                  ? <div style={{ marginBottom: 10 }}>{a.documents.map((d) => (
                      <div className="doc" key={d.id}><span className="fname">{d.filename}</span></div>))}</div>
                  : <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{t('docs.none')}</div>}
                <Dropzone onFiles={(fs) => upload(a.id, fs)} />
              </section>
            </>
          )}

          <h2 className="gov-sec-title">{t('results.title')}</h2>
          <div className="gov-applist">
            {a.destinations.map((d, i) => (
              <div key={d.id} className={`dcard ${ringClass(d.match?.score ?? 0)}`} style={{ cursor: 'default' }}>
                <div className="rank">{i + 1}</div>
                <ScoreDial score={d.match?.score ?? 0} />
                <div className="info">
                  <h4>{L(d, 'name')}</h4>
                  <div className="attrs">
                    <span>{t('d.cost')} <b>{t('common.hkd')}{d.monthly_cost.toLocaleString()}</b></span>
                    <span>{t('d.travel')} <b>{d.travel_time_hr}{t('common.hours')}</b></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </GovShell>
    );
  }

  // ---------- portal homepage ----------
  const hasApp = (apps?.length ?? 0) > 0;
  const tiles = [
    // one application per resident — the "start" tile disappears once you have one
    ...(hasApp ? [] : [{ ic: Icon.apply, title: t('tile.start'), desc: t('tile.start.d'), onClick: onNew }]),
    { ic: Icon.list, title: t('tile.myapps'), desc: t('tile.myapps.d'), onClick: scrollToList },
    { ic: Icon.guide, title: t('tile.guide'), desc: t('tile.guide.d'), onClick: scrollToList },
    { ic: Icon.elderly, title: t('tile.elderly'), desc: t('tile.elderly.d'), onClick: scrollToList },
  ];

  return (
    <GovShell crumbs={[t('nav.home'), t('nav.residents'), t('nav.service')]}>
      <div className="gov-content">
        <section className="gov-hero">
          <div>
            <h1>{t('hero.title')}</h1>
            <p>{t('hero.sub')}</p>
          </div>
          {hasApp
            ? <span style={{ color: '#fff', fontSize: 14, opacity: 0.9, maxWidth: 220 }}>{t('home.oneNote')}</span>
            : <button className="btn btn-primary btn-lg" onClick={onNew}>{t('tile.start')} →</button>}
        </section>

        <h2 className="gov-sec-title">{t('home.services')}</h2>
        <div className="gov-tiles">
          {tiles.map((tile, i) => (
            <button key={i} className="gov-tile" onClick={tile.onClick}>
              <span className="ic">{tile.ic}</span>
              <h4>{tile.title}</h4>
              <p>{tile.desc}</p>
            </button>
          ))}
        </div>

        <h2 className="gov-sec-title" ref={listRef}>{t('home.yourapps')}</h2>
        <div className="gov-applist">
          {apps === null && <div className="center-msg">{t('common.loading')}</div>}

          {apps !== null && apps.length === 0 && (
            <div className="applist-empty">{t('dash.empty')}</div>
          )}

          {apps?.map((a) => {
            const dest = a.top_destination;
            return (
              <div key={a.id} className="dcard" onClick={() => setSelectedId(a.id)}>
                <div className="rank">#{a.id}</div>
                <div className="info">
                  <h4>{dest ? L(dest, 'name') : t('dash.app')}</h4>
                  <div className="attrs">
                    <span>{t('dash.submitted_on')} <b>{fmtDate(a.created_at)}</b></span>
                    <span>{t('docs.title')} <b>{a.documents.length}</b></span>
                  </div>
                </div>
                <span className={`badge badge-${a.status}`}>{t(`status.${a.status}`)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </GovShell>
  );
}
