import ReactDOM from 'react-dom/client';
import './styles/theme.css';
import { LanguageProvider } from './i18n/LanguageProvider';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>,
);
