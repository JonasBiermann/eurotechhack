import { useState } from 'react';
import { useI18n } from './i18n/LanguageProvider';
import { MapCanvas, type MapState } from './map/MapCanvas';
import { GovernmentView } from './views/GovernmentView';

const DEFAULT_VIEW: MapState = {
  layer: 'heatmap', metric: 'age', origin: null, footprintsBbox: null,
  destinations: [], selectedDestId: null, focus: null,
  gbaPins: [],
};

export default function App() {
  const { t, lang, toggle } = useI18n();
  const [view, setView] = useState<MapState>(DEFAULT_VIEW);

  return (
    <div className="app">
      <MapCanvas view={view} lang={lang} />
      <header className="app-header">
        <div className="brand">
          <div className="logo" />
          <div className="brand-text">
            <b>{t('app.title')}</b>
            <small>{t('app.subtitle')}</small>
          </div>
        </div>
        <div className="header-spacer" />
        <span className="gov-chip">{t('mode.government')}</span>
        <button className="lang-btn" onClick={toggle} title="EN / 繁體中文">{t('lang.name')}</button>
      </header>
      <GovernmentView view={view} setView={setView} />
    </div>
  );
}
