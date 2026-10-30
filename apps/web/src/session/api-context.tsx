import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from '@onway/contracts/client';

const ApiContext = createContext<ApiClient | null>(null);

/** El cliente generado se entrega por contexto para poder sustituir `fetch` en las pruebas. */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('ApiProvider ausente');
  return client;
}
