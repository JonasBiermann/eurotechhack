import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type Application } from '../api/client';
import { GovShell } from '../components/GovShell';

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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.myApplications().then(setApps).catch(() => setApps([]));
  }, []);

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK'); }
    catch { return iso?.slice(0, 10) ?? ''; }
  };
  const scrollToList = () => listRef.current?.scrollIntoView({ behavior: 'smooth' });

  const tiles = [
    { ic: Icon.apply, title: t('tile.start'), desc: t('tile.start.d'), onClick: onNew },
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
          <button className="btn btn-primary btn-lg" onClick={onNew}>{t('tile.start')} →</button>
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
              <div key={a.id} className="dcard" style={{ cursor: 'default' }}>
                <div className="rank">#{a.id}</div>
                <div className="info">
                  <h4>{dest ? L(dest, 'name') : t('dash.app')}</h4>
                  <div className="attrs">
                    <span>{t('dash.submitted_on')} <b>{fmtDate(a.created_at)}</b></span>
                    <span>{t('docs.title')} <b>{a.documents.length}</b></span>
                  </div>
                  {a.note && <div className="blurb"><b>{t('sub.officerNote')}:</b> {a.note}</div>}
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
