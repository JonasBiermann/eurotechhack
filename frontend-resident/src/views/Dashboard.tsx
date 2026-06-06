import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { useAuth } from '../auth/AuthProvider';
import { api, type Application } from '../api/client';

export function Dashboard({ onNew }: { onNew: () => void }) {
  const { t, L, lang, toggle } = useI18n();
  const { resident, logout } = useAuth();
  const [apps, setApps] = useState<Application[] | null>(null);

  useEffect(() => {
    api.myApplications().then(setApps).catch(() => setApps([]));
  }, []);

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK'); }
    catch { return iso?.slice(0, 10) ?? ''; }
  };

  return (
    <>
      <header className="topbar">
        <div className="brand"><div className="logo" /><b>{t('app.title')}</b><small>{t('app.tagline')}</small></div>
        <div className="spacer" />
        {resident && <span className="who">{resident.name}</span>}
        <button className="lang-btn" onClick={toggle} title="EN / 繁體中文">{t('lang.name')}</button>
        <button className="btn" onClick={logout}>{t('auth.logout')}</button>
      </header>

      <div className="flow">
        <div className="dash-inner">
          <div className="dash-head">
            <div>
              <div className="eyebrow">{t('app.title')} · {t('mode.resident')}</div>
              <h1 className="q-title">{t('dash.title')}</h1>
              <p className="q-sub">{t('dash.sub')}</p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={onNew}>{t('dash.new')} →</button>
          </div>

          {apps === null && <div className="center-msg">{t('common.loading')}</div>}

          {apps !== null && apps.length === 0 && (
            <section className="section" style={{ marginTop: 18, textAlign: 'center' }}>
              <p className="muted" style={{ padding: '24px 0' }}>{t('dash.empty')}</p>
            </section>
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
    </>
  );
}
