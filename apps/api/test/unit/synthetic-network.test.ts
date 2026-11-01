import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NETWORK, syntheticNetworkXml } from '../../src/geo/synthetic-network.js';

describe('syntheticNetworkXml', () => {
  const xml = syntheticNetworkXml();

  it('is deterministic and the version in the repository is the generated one', () => {
    expect(syntheticNetworkXml()).toBe(xml);
    expect(readFileSync(join(import.meta.dirname, '../../../../data/seed/network.osm'), 'utf8')).toBe(xml);
  });

  it('is a lattice of 19 x 9 nodes with 18 x 9 + 19 x 8 edges', () => {
    expect(xml.match(/<node /g)).toHaveLength(19 * 9);
    expect(xml.match(/<way /g)).toHaveLength(18 * 9 + 19 * 8);
  });

  it('has one road parallel, tracks on the outer meridians and paths everywhere else', () => {
    expect(xml.match(/k='highway' v='unclassified'/g)).toHaveLength(18);
    expect(xml.match(/k='highway' v='track'/g)).toHaveLength(2 * 8);
    expect(xml.match(/k='highway' v='path'/g)).toHaveLength(18 * 8 + 17 * 8);
  });

  it('names the pass on the made-up border and keeps every node inside the box and the synthetic DEM tiles', () => {
    expect(xml).toContain('Collado ficticio de la frontera');
    const lats = [...xml.matchAll(/lat='([-\d.]+)'/g)].map((m) => Number(m[1]));
    const lons = [...xml.matchAll(/lon='([-\d.]+)'/g)].map((m) => Number(m[1]));
    expect(Math.min(...lats)).toBe(NETWORK.south);
    expect(Math.max(...lats)).toBe(NETWORK.north);
    expect(Math.min(...lons)).toBe(NETWORK.west);
    expect(Math.max(...lons)).toBe(NETWORK.east);
    expect(lons.some((lon) => lon === NETWORK.border)).toBe(true);
  });

  it('contains nothing but made-up places: no names other than the pass', () => {
    expect([...xml.matchAll(/k='name' v='([^']+)'/g)].map((m) => m[1])).toEqual(['Collado ficticio de la frontera']);
  });
});
