import { Fragment } from 'react';
import { useI18n } from '../i18n/LanguageProvider';

type Crumb = string | { label: string; onClick: () => void };

/**
 * GovHK-style portal chrome — utility bar, "SilverLink 銀聯橋" masthead and red
 * breadcrumb/nav band — shared with the resident app. Chrome only: the map and the
 * console panel sit beneath it (the government console is a map workspace, not a
 * scrolling page, so there is no .gov-main / footer here).
 */
export function GovShell({ crumbs }: { crumbs: Crumb[] }) {
  const { t, lang, setLang } = useI18n();

  return (
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
        <div className="gov-logo">SL</div>
        <div className="gov-brand">
          <span className="nm">SilverLink<span className="tc">銀聯橋</span></span>
          <span className="sub">{t('gov.brand.sub')}</span>
        </div>
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
        <div className="gov-account">
          <span className="gov-role">{t('mode.government')} 政府</span>
        </div>
      </div>
    </div>
  );
}
