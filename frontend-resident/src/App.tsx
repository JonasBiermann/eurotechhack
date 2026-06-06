import { useState } from 'react';
import { useI18n } from './i18n/LanguageProvider';
import { MapCanvas, type MapState } from './map/MapCanvas';
import { ResidentWizard } from './views/ResidentWizard';

const DEFAULT_VIEW: MapState = {
  layer: 'none', metric: 'age', origin: null, footprintsBbox: null,
  destinations: [], selectedDestId: null, focus: null,
};

export default function App() {
  const { lang } = useI18n();
  const [view, setView] = useState<MapState>(DEFAULT_VIEW);

  // The map is always mounted; the flow covers it for the question steps
  // and reveals it (with city pins) once the resident reaches the results.
  return (
    <div className="app">
      <MapCanvas view={view} lang={lang} />
      <ResidentWizard setView={setView} />
    </div>
  );
}
