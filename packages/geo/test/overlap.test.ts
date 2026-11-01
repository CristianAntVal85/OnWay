import { describe, expect, it } from 'vitest';
import { haversineM } from '../src/geometry.js';
import { distanceToLineM, resampleLine, sharedShare, squareRing } from '../src/overlap.js';

// A straight line due east along 42.6 N: 0.01 degrees of longitude are ~822 m there.
const line = (from: number, to: number, steps: number): [number, number][] => Array.from({ length: steps + 1 }, (_, i) => [from + ((to - from) * i) / steps, 42.6]);

describe('resampleLine', () => {
  it('puts a point every step along the line and keeps the end', () => {
    const coords = line(0.6, 0.7, 4);
    const points = resampleLine(coords, 250);
    expect(points[0]).toEqual(coords[0]);
    expect(points[points.length - 1]).toEqual(coords[4]);
    const length = coords.slice(1).reduce((sum, c, i) => sum + haversineM(coords[i]!, c), 0);
    expect(Math.abs(points.length - 1 - Math.ceil(length / 250))).toBeLessThanOrEqual(1);
  });
  it('answers empty for an empty line and one point for one point', () => {
    expect(resampleLine([], 10)).toEqual([]);
    expect(resampleLine([[0.6, 42.6]], 10)).toEqual([[0.6, 42.6]]);
  });
});

describe('distanceToLineM', () => {
  it('is 0 on the line and ~110.6 m for 0.001 degrees of latitude', () => {
    const coords = line(0.6, 0.7, 4);
    expect(distanceToLineM([0.65, 42.6], coords)).toBeLessThan(0.01);
    expect(distanceToLineM([0.65, 42.601], coords)).toBeCloseTo(111.2, 0);
  });
  it('measures to the end of the line when the closest point is the end', () => {
    expect(distanceToLineM([0.71, 42.6], line(0.6, 0.7, 4))).toBeGreaterThan(800);
  });
});

describe('sharedShare', () => {
  const main = line(0.6, 0.7, 10);
  it('is 1 for the same line, 0 for a disjoint one and about a half for half-overlapping ones', () => {
    expect(sharedShare(main, main)).toBe(1);
    expect(
      sharedShare(
        main.map(([lon]) => [lon!, 42.62]),
        main,
      ),
    ).toBe(0);
    // First half on the main line, then 55 m to the side (beyond the 15 m tolerance): ~47 % shared.
    const half = [...line(0.6, 0.65, 5), [0.65, 42.6005], [0.7, 42.6005]];
    const share = sharedShare(half, main);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});

describe('squareRing', () => {
  it('is a closed ring of about 2 x halfM per side around the centre', () => {
    const ring = squareRing([0.65, 42.6], 100);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(haversineM(ring[0]!, ring[1]!)).toBeCloseTo(200, 0);
    expect(haversineM(ring[1]!, ring[2]!)).toBeCloseTo(200, 0);
  });
});
