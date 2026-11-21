import { describe, expect, it } from 'vitest';
import { cumulativeM, cutAt, pointAtDistance, projectOnLine } from '../src/cut.js';
import { haversineM, lengthM } from '../src/geometry.js';

// A straight line due east along 42.6 N, one vertex every ~25 m (0.0003 degrees of longitude).
const line: [number, number][] = Array.from({ length: 41 }, (_, i) => [0.6 + i * 0.0003, 42.6]);
// 0.0009 degrees of latitude are ~100 m.
const NORTH_100_M = 0.0009;

describe('cumulativeM', () => {
  it('starts at 0 and ends at the length of the line', () => {
    const along = cumulativeM(line);
    expect(along[0]).toBe(0);
    expect(along).toHaveLength(line.length);
    expect(along[along.length - 1]).toBeCloseTo(lengthM(line), 6);
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThan(along[i - 1]!);
  });
});

describe('projectOnLine', () => {
  it('a point on a vertex is that vertex, with no offset', () => {
    const cut = projectOnLine(line, line[12]!);
    expect(cut.index).toBe(12);
    expect(cut.point).toEqual(line[12]);
    expect(cut.offsetM).toBe(0);
    expect(cut.distanceM).toBeCloseTo(lengthM(line.slice(0, 13)), 6);
  });

  it('a point between two vertices goes to the nearest one, at most half the spacing away', () => {
    const between = [line[20]![0] + 0.0001, 42.6];
    const cut = projectOnLine(line, between);
    expect(cut.index).toBe(20);
    expect(cut.offsetM).toBeLessThan(haversineM(line[20]!, line[21]!) / 2);
  });

  it('a point 100 m to the side says how far it is', () => {
    const cut = projectOnLine(line, [line[30]![0], 42.6 + NORTH_100_M]);
    expect(cut.index).toBe(30);
    expect(cut.offsetM).toBeGreaterThan(95);
    expect(cut.offsetM).toBeLessThan(105);
  });

  it('works on a line of two vertices and on one of a single vertex', () => {
    expect(projectOnLine([line[0]!, line[1]!], line[1]!).index).toBe(1);
    expect(projectOnLine([line[0]!], [0.7, 42.7]).index).toBe(0);
  });

  it('refuses an empty line', () => {
    expect(() => projectOnLine([], [0.6, 42.6])).toThrow(RangeError);
  });
});

describe('pointAtDistance', () => {
  const total = lengthM(line);

  it('0 is the start and the length is the end', () => {
    expect(pointAtDistance(line, 0).index).toBe(0);
    expect(pointAtDistance(line, total).index).toBe(line.length - 1);
  });

  it('the middle is the middle vertex', () => {
    expect(pointAtDistance(line, total / 2).index).toBe(20);
  });

  it('beyond the end stays at the end, and below 0 at the start', () => {
    expect(pointAtDistance(line, total + 5_000).index).toBe(line.length - 1);
    expect(pointAtDistance(line, -10).index).toBe(0);
  });

  it('answers the distance of the vertex it chose', () => {
    const cut = pointAtDistance(line, 260);
    expect(Math.abs(cut.distanceM - 260)).toBeLessThan(13);
    expect(cut.distanceM).toBeCloseTo(cumulativeM(line)[cut.index]!, 6);
  });
});

describe('cutAt', () => {
  it('keeps the vertices from the start to the index, included', () => {
    expect(cutAt(line, 0)).toEqual([line[0]]);
    expect(cutAt(line, 3)).toEqual(line.slice(0, 4));
    expect(cutAt(line, line.length - 1)).toEqual(line);
  });

  it('refuses an index outside the line', () => {
    expect(() => cutAt(line, -1)).toThrow(RangeError);
    expect(() => cutAt(line, line.length)).toThrow(RangeError);
    expect(() => cutAt(line, 1.5)).toThrow(RangeError);
  });
});
