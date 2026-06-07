import { Fragment, type ReactNode } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { useAuth } from '../auth/AuthProvider';

type Crumb = string | { label: string; onClick: () => void };

/** GovHK-style portal chrome: utility bar, masthead, teal breadcrumb band, footer. */
export function GovShell({ crumbs, children, chromeOnly }: {
  crumbs: Crumb[]; children: ReactNode; chromeOnly?: boolean;
}) {
  const { t, lang, setLang } = useI18n();
  const { resident, logout } = useAuth();

  const chrome = (
    <div className="gov-chrome">
      <div className="gov-utility">
        <div className="spacer" />
        <div className="gov-langs">
          <button className={`gov-lang ${lang === 'en' ? 'on' : ''}`} onClick={() => setLang('en')}>English</button>
          <span className="gov-divider">|</span>
          <button className={`gov-lang ${lang === 'zh' ? 'on' : ''}`} onClick={() => setLang('zh')}>繁體中文</button>
        </div>
        <span className="gov-divider">|</span>
        <button className="gov-util-link">{t('gov.sitemap')}</button>
        <button className="gov-util-link">{t('gov.contact')}</button>
      </div>

      <div className="gov-masthead">
        <div className="gov-logo">安</div>
        <div className="gov-brand">
          <span className="nm">OnKui<span className="tc">安居</span></span>
          <span className="sub">{t('gov.brand.sub')}</span>
        </div>
        <form className="gov-search" onSubmit={(e) => e.preventDefault()}>
          <input placeholder={t('gov.search.ph')} aria-label={t('gov.search.btn')} />
          <button type="submit">{t('gov.search.btn')}</button>
        </form>
      </div>

      <div className="gov-nav">
        <nav className="gov-breadcrumb">
          {crumbs.map((c, i) => {
            const label = typeof c === 'string' ? c : c.label;
            const onClick = typeof c === 'string' ? undefined : c.onClick;
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <span className="sep">›</span>}
                {onClick
                  ? <button className="crumb crumb-link" onClick={onClick}>{label}</button>
                  : <span className={`crumb ${last ? 'cur' : ''}`}>{label}</span>}
              </Fragment>
            );
          })}
        </nav>
        {resident && (
          <div className="gov-account">
            <span className="who2">{t('gov.signedin')}: {resident.name}</span>
            <button className="out" onClick={logout}>{t('auth.logout')}</button>
          </div>
        )}
      </div>
    </div>
  );

  if (chromeOnly) return <>{chrome}{children}</>;

  return (
    <>
      {chrome}
      <main className="gov-main">
        {children}
        <footer className="gov-footer">
          <div className="fin">
            <div className="gov-foot-links">
              <a>{t('foot.about')}</a>
              <a>{t('foot.accessibility')}</a>
              <a>{t('foot.help')}</a>
              <a>{t('foot.copyright')}</a>
              <a>{t('foot.privacy')}</a>
              <a>{t('foot.disclaimer')}</a>
            </div>
            <div className="gov-foot-note">{t('foot.rights')}</div>
          </div>
        </footer>
      </main>
    </>
  );
}
