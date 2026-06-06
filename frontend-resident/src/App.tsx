import { useState } from 'react';
import { useI18n } from './i18n/LanguageProvider';
import { useAuth } from './auth/AuthProvider';
import { MapCanvas, type MapState } from './map/MapCanvas';
import { ResidentWizard } from './views/ResidentWizard';
import { AuthScreen } from './views/AuthScreen';
import { Dashboard } from './views/Dashboard';

const DEFAULT_VIEW: MapState = {
  layer: 'none', metric: 'age', origin: null, footprintsBbox: null,
  destinations: [], selectedDestId: null, focus: null,
};

export default function App() {
  const { lang, t } = useI18n();
  const { resident, loading } = useAuth();
  const [view, setView] = useState<MapState>(DEFAULT_VIEW);
  const [page, setPage] = useState<'dashboard' | 'new'>('dashboard');

  if (loading) {
    return <div className="app"><div className="center-msg" style={{ marginTop: '45vh' }}>{t('common.loading')}</div></div>;
  }

  if (!resident) {
    return <div className="app"><AuthScreen /></div>;
  }

  // The map is always mounted; the dashboard / wizard cover it, and the wizard
  // reveals it (with city pins) once the resident reaches the results.
  return (
    <div className="app">
      <MapCanvas view={view} lang={lang} />
      {page === 'dashboard'
        ? <Dashboard onNew={() => setPage('new')} />
        : <ResidentWizard setView={setView} onExit={() => { setView(DEFAULT_VIEW); setPage('dashboard'); }} />}
    </div>
  );
}
