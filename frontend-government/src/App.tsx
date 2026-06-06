import { useState } from 'react';
import { useI18n } from './i18n/LanguageProvider';
import { MapCanvas, type MapState } from './map/MapCanvas';
import { GovernmentView } from './views/GovernmentView';
import { GovShell } from './components/GovShell';

const DEFAULT_VIEW: MapState = {
  layer: 'heatmap', metric: 'age', origin: null, footprintsBbox: null,
  destinations: [], selectedDestId: null, focus: null,
  gbaPins: [],
};

export default function App() {
  const { t, lang } = useI18n();
  const [view, setView] = useState<MapState>(DEFAULT_VIEW);

  return (
    <div className="app">
      <MapCanvas view={view} lang={lang} />
      <GovShell crumbs={[t('nav.home'), t('nav.service'), t('nav.console')]} />
      <GovernmentView view={view} setView={setView} />
    </div>
  );
}
