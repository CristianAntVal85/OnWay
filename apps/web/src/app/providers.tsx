import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { i18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ApiClient } from '@onway/contracts/client';
import { useLocaleSync } from '../i18n/use-locale';
import { ApiProvider } from '../session/api-context';
import { useSession } from '../session/session';

function LocaleSync() {
  const { data } = useSession();
  useLocaleSync(data?.status === 'authenticated' ? data.user.locale : null);
  return null;
}

export interface AppProvidersProps {
  api: ApiClient;
  queryClient: QueryClient;
  i18n: i18n;
  children: ReactNode;
}

export function AppProviders({ api, queryClient, i18n, children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <QueryClientProvider client={queryClient}>
          <LocaleSync />
          {children}
        </QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>
  );
}
