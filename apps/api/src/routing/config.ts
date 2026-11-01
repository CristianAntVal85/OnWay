import { DomainError } from '../common/domain-error.js';
import { GraphHopperRouting } from './graphhopper-routing.js';
import type { AlternativesRequest, EngineRoute, RoutingProvider } from './routing.js';

type Env = Record<string, string | undefined>;

/** The engine is not configured: every call is `ROUTING_UNAVAILABLE`, and the rest of the application works (doc 04 §11.4). */
class UnavailableRouting implements RoutingProvider {
  alternatives(_request: AlternativesRequest): Promise<EngineRoute[]> {
    return Promise.reject(new DomainError('ROUTING_UNAVAILABLE'));
  }
  snap(): Promise<EngineRoute> {
    return Promise.reject(new DomainError('ROUTING_UNAVAILABLE'));
  }
  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** The real `RoutingProvider`: GraphHopper at `ROUTING_URL` (the `routing` service of the compose). Without the URL, always unavailable. */
export function createRoutingProvider(env: Env = process.env): RoutingProvider {
  return env.ROUTING_URL ? new GraphHopperRouting({ baseUrl: env.ROUTING_URL }) : new UnavailableRouting();
}
