import { Fragment, type ReactNode } from 'react';
import { useI18n } from '../i18n/LanguageProvider';

/** GovHK-style portal chrome — officer edition (no resident auth). */
export function GovShell({ crumbs, children }: {
  crumbs: string[]; children?: ReactNode;
}) {
  const { t, lang, toggle } = useI18n();

  return (
    <>
      <div className="gov-chrome">
        <div className="gov-utility">
          <div className="spacer" />
          <div className="gov-langs">
            <button className={`gov-lang ${lang === 'en' ? 'on' : ''}`} onClick={() => lang !== 'en' && toggle()}>
              English
            </button>
            <span className="gov-divider">|</span>
            <button className={`gov-lang ${lang === 'zh' ? 'on' : ''}`} onClick={() => lang !== 'zh' && toggle()}>
              繁體中文
            </button>
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
          <div className="gov-masthead-spacer" />
          <div className="gov-officer-chip">
            {t('gov.officer.chip')}
          </div>
        </div>

        <div className="gov-nav">
          <nav className="gov-breadcrumb">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <Fragment key={i}>
                  {i > 0 && <span className="sep">›</span>}
                  <span className={`crumb ${last ? 'cur' : ''}`}>{c}</span>
                </Fragment>
              );
            })}
          </nav>
        </div>
      </div>

      {children}
    </>
  );
}
