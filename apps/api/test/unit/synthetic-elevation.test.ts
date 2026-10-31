import { describe, expect, it } from 'vitest';
import { SYNTHETIC_COVERAGE, SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';

describe('SyntheticElevationProvider (stand-in for the ElevationProvider port until the geodata task)', () => {
  const provider = new SyntheticElevationProvider();

  it('is deterministic: the same point always has the same altitude', async () => {
    const first = await provider.elevationAt({ lat: 42.6, lon: 0.65 });
    expect(first).toBe(await provider.elevationAt({ lat: 42.6, lon: 0.65 }));
    expect(first).not.toBeNull();
  });

  it('gives different altitudes to different points, always within the range the contract admits', async () => {
    const seen = new Set<number>();
    for (let lat = 41.2; lat < 44.4; lat += 0.37) {
      for (let lon = -3.3; lon < 3.9; lon += 0.41) {
        const metres = await provider.elevationAt({ lat, lon });
        expect(metres).not.toBeNull();
        expect(metres!).toBeGreaterThanOrEqual(-500);
        expect(metres!).toBeLessThanOrEqual(9000);
        seen.add(metres!);
      }
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('answers null outside its coverage box, edges included inside', async () => {
    const { south, north, west, east } = SYNTHETIC_COVERAGE;
    expect(await provider.elevationAt({ lat: south - 0.001, lon: 0 })).toBeNull();
    expect(await provider.elevationAt({ lat: north + 0.001, lon: 0 })).toBeNull();
    expect(await provider.elevationAt({ lat: 42, lon: west - 0.001 })).toBeNull();
    expect(await provider.elevationAt({ lat: 42, lon: east + 0.001 })).toBeNull();
    expect(await provider.elevationAt({ lat: 0, lon: 0 })).toBeNull();
    expect(await provider.elevationAt({ lat: south, lon: west })).not.toBeNull();
    expect(await provider.elevationAt({ lat: north, lon: east })).not.toBeNull();
  });
});
