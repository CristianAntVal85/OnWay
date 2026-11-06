import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { createApiClient } from '@onway/contracts/client';
import { AppProviders } from './app/providers';
import { AppRoutes } from './app/routes';
import { createI18n } from './i18n';
import { initialLocale } from './i18n/locale';
import { browserStorage } from './i18n/use-locale';
import { createQueryClient } from './session/session';
import './theme/tokens.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root');

createRoot(root).render(
  <StrictMode>
    <AppProviders api={createApiClient()} queryClient={createQueryClient()} i18n={createI18n(initialLocale(browserStorage(), navigator.language))}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
