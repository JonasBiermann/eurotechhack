import { useState } from 'react';
import { useI18n } from './i18n/LanguageProvider';
import { MapCanvas, type MapState } from './map/MapCanvas';
import { GovernmentView } from './views/GovernmentView';

const DEFAULT_VIEW: MapState = {
  layer: 'heatmap', metric: 'age', origin: null, footprintsBbox: null,
  destinations: [], selectedDestId: null, focus: null,
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
          <b>{t('app.title')}</b>
          <small>{t('app.tagline')}</small>
        </div>
        <div className="header-spacer" />
        <span style={{
          padding: '7px 14px', borderRadius: 11, fontWeight: 700, fontSize: 13,
          color: '#170c2e', background: 'linear-gradient(135deg,#a78bfa,#c4b1fb)',
        }}>{t('mode.government')}</span>
        <button className="lang-btn" onClick={toggle} title="EN / 繁體中文">{t('lang.name')}</button>
      </header>
      <GovernmentView setView={setView} />
    </div>
  );
}
