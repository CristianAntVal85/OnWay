import { readFile } from 'node:fs/promises';
import { haversineM, parseTrack } from '@onway/geo';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../src/common/domain-error.js';
import type { ElevationProvider } from '../../src/geo/elevation.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { RouteMeasurement } from '../../src/routes/route-measurement.js';

const fixture = async (name: string) => parseTrack(await readFile(new URL(`../../../../packages/geo/test/fixtures/${name}`, import.meta.url), 'utf8'));
const synthetic = new SyntheticElevationProvider();
const measurement = new RouteMeasurement(synthetic);

describe('RouteMeasurement (D-H2-01: round, thin, densify, altitude in one batch, measure, one unclassified stretch)', () => {
  it('measures a track from its fixture: prepared vertices at most 30 m apart, the server’s altitude, one `unknown` stretch', async () => {
    const { line } = await fixture('ficticio-sendero.gpx');
    const measured = await measurement.measure(line);

    for (let i = 1; i < measured.coordinates.length; i++) {
      expect(haversineM(measured.coordinates[i - 1]!, measured.coordinates[i]!)).toBeLessThanOrEqual(30.2);
    }
    for (const [lon, lat, height] of measured.coordinates) expect(height).toBe(await synthetic.elevationAt({ lat, lon }));
    expect(measured.coordinates.some(([, , height]) => height === 999)).toBe(false);

    const distance = measured.coordinates.slice(1).reduce((sum, position, i) => sum + haversineM(measured.coordinates[i]!, position), 0);
    expect(measured.metrics.distanceM).toBeCloseTo(distance, 0);
    expect(measured.roadMix).toEqual([{ roadType: 'unknown', distanceM: measured.metrics.distanceM }]);
    expect(measured.segments).toEqual([{ position: 0, roadType: 'unknown', distanceM: measured.metrics.distanceM, ascentM: measured.metrics.ascentM, descentM: measured.metrics.descentM }]);
    expect(measured.profile.length).toBeGreaterThanOrEqual(2);
    expect(measured.profile.length).toBeLessThanOrEqual(500);
  });

  it('asks for all the altitudes in one batch, never one by one', async () => {
    const { line } = await fixture('ficticio-sendero.gpx');
    const provider: ElevationProvider = { elevationAt: vi.fn(async () => 1), elevationsAt: vi.fn(async (points) => points.map(() => 1500)) };
    const measured = await new RouteMeasurement(provider).measure(line);
    expect(provider.elevationsAt).toHaveBeenCalledTimes(1);
    expect(provider.elevationAt).not.toHaveBeenCalled();
    expect(vi.mocked(provider.elevationsAt).mock.calls[0]![0]).toHaveLength(measured.coordinates.length);
    expect(measured.metrics).toMatchObject({ ascentM: 0, descentM: 0, minElevationM: 1500, maxElevationM: 1500, maxSlopePct: 0 });
  });

  it('is stable: measuring the vertices it produced gives the same vertices and metrics (what is exported and imported again does not drift)', async () => {
    const { line } = await fixture('ficticio-sendero.gpx');
    const first = await measurement.measure(line);
    const second = await measurement.measure(first.coordinates.map(([lon, lat]) => [lon, lat]));
    expect(second.coordinates).toEqual(first.coordinates);
    expect(second.metrics).toEqual(first.metrics);
  });

  it('ignores any altitude in the input (INV-15): a third coordinate of 999 changes nothing', async () => {
    const { line } = await fixture('ficticio-sendero.gpx');
    const plain = await measurement.measure(line);
    const faked = await measurement.measure(line.map(([lon, lat]) => [lon, lat, 999]));
    expect(faked).toEqual(plain);
  });

  it('answers OUTSIDE_COVERAGE when any vertex has no altitude', async () => {
    const nowhere: ElevationProvider = { elevationAt: async () => null, elevationsAt: async (points) => points.map((_, i) => (i === 3 ? null : 100)) };
    await expect(
      new RouteMeasurement(nowhere).measure([
        [0.1, 42.6],
        [0.11, 42.61],
      ]),
    ).rejects.toMatchObject({ code: 'OUTSIDE_COVERAGE' });
    await expect(
      measurement.measure([
        [40, 10],
        [40.01, 10.01],
      ]),
    ).rejects.toMatchObject({ code: 'OUTSIDE_COVERAGE' });
  });

  it('refuses a line with no length and a line that would need more than the limit of vertices', async () => {
    for (const line of [
      [[0.1, 42.6]],
      [
        [0.1, 42.6],
        [0.1, 42.6],
      ],
      [
        [0.1, 42.6],
        [0.10000001, 42.6],
      ],
    ]) {
      await expect(measurement.measure(line)).rejects.toBeInstanceOf(DomainError);
      await expect(measurement.measure(line)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    // Two points 3 000 km apart become 100 000 vertices at 30 m.
    await expect(
      measurement.measure([
        [-3, 42],
        [-3, 42 + 27],
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ code: 'too_long' }] } });
  });
});
