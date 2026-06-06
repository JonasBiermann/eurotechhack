import { useState } from 'react';
import { useI18n } from './i18n/LanguageProvider';
import { MapCanvas, type MapState } from './map/MapCanvas';
import { GovernmentView } from './views/GovernmentView';
import { ResidentWizard } from './views/ResidentWizard';

const DEFAULT_VIEW: MapState = {
  layer: 'heatmap', metric: 'age', origin: null, footprintsBbox: null,
  destinations: [], selectedDestId: null, focus: null,
};

export default function App() {
  const { t, lang, toggle } = useI18n();
  const [mode, setMode] = useState<'resident' | 'gov'>('gov');
  const [view, setView] = useState<MapState>(DEFAULT_VIEW);

  return (
    <div className={`app ${mode === 'resident' ? 'resident' : ''}`}>
      <MapCanvas view={view} lang={lang} />

      <header className="app-header">
        <div className="brand">
          <div className="logo" />
          <b>{t('app.title')}</b>
          <small>{t('app.tagline')}</small>
        </div>
        <div className="header-spacer" />
        <div className={`seg ${mode === 'gov' ? 'violet' : ''}`}>
          <button className={mode === 'resident' ? 'active' : ''} onClick={() => setMode('resident')}>
            {t('mode.resident')}</button>
          <button className={mode === 'gov' ? 'active' : ''} onClick={() => setMode('gov')}>
            {t('mode.government')}</button>
        </div>
        <button className="lang-btn" onClick={toggle} title="EN / 繁體中文">{t('lang.name')}</button>
      </header>

      {mode === 'gov'
        ? <GovernmentView key="gov" setView={setView} />
        : <ResidentWizard key="resident" setView={setView} />}
    </div>
  );
}
