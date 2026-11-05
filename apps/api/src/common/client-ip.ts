import { isIPv6 } from 'node:net';
import type { Request } from 'express';

/**
 * The key the public rate limit counts a client by.
 *
 * Where the address comes from is decided by Express's `trust proxy` setting (`createApp`, `TRUSTED_PROXIES`), not here: `request.ip` is
 * the socket address unless the connection comes from a trusted proxy, and only then is `X-Forwarded-For` read, from the right, skipping
 * trusted hops. So a client that reaches the `api` by any other road cannot pick its own address by sending that header, and one that goes
 * through Caddy cannot either (Caddy replaces the header it receives with the address it sees).
 *
 * An IPv6 client owns a whole /64 and can change address inside it at will, so it counts as that /64.
 */
export function clientKey(request: Pick<Request, 'ip' | 'socket'>): string {
  const raw = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1]!;
  return isIPv6(raw) ? ipv6Prefix64(raw) : raw;
}

function ipv6Prefix64(address: string): string {
  const [head = '', tail] = address.split('%')[0]!.split('::') as [string, string?];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** Only a loopback, link-local or private-range peer is believed when it says who the client is; a peer on a public address never is. */
export const DEFAULT_TRUSTED_PROXIES = 'loopback, linklocal, uniquelocal';

/**
 * `TRUSTED_PROXIES` (Express's `trust proxy` syntax: names, addresses or CIDR ranges, comma separated; `false` for none). The `api` is
 * not published: in the stack only Caddy reaches it, over the private network of Docker. Narrow it to Caddy's own address if other
 * containers could reach port 3000.
 */
export function trustedProxiesFromEnv(env: Record<string, string | undefined>): string | false {
  const value = env.TRUSTED_PROXIES?.trim();
  if (!value) return DEFAULT_TRUSTED_PROXIES;
  return value === 'false' ? false : value;
}
