import { describe, expect, it } from 'vitest';
import { groupIntervals, labelIntervals } from '../src/segments.js';

// A straight line due east along 42.6 N; 0.001 degrees of longitude are ~82 m there.
const line = (count: number, to = 0.01): number[][] => Array.from({ length: count }, (_, i) => [0.6 + (to * i) / (count - 1), 42.6]);

describe('labelIntervals', () => {
  it('carries the labels to a line with other vertices, by share of the length', () => {
    const original = line(11); // vertices 0..10
    const prepared = line(41); // four times as many vertices over the same path
    const labels = labelIntervals(
      original,
      prepared,
      [
        { fromIndex: 0, toIndex: 4, value: 'road' },
        { fromIndex: 4, toIndex: 10, value: 'path' },
      ],
      'unknown',
    );
    expect(labels).toHaveLength(40);
    expect(labels.slice(0, 16).every((label) => label === 'road')).toBe(true);
    expect(labels.slice(16).every((label) => label === 'path')).toBe(true);
  });

  it('works when the prepared line is a little longer or shorter than the engine’s (rounding)', () => {
    const labels = labelIntervals(
      line(11),
      line(21, 0.0101),
      [
        { fromIndex: 0, toIndex: 5, value: 'track' },
        { fromIndex: 5, toIndex: 10, value: 'path' },
      ],
      'unknown',
    );
    expect(labels.filter((label) => label === 'track')).toHaveLength(10);
    expect(labels.filter((label) => label === 'path')).toHaveLength(10);
  });

  it('gives the fallback to what no stretch covers, and to everything when there are no stretches', () => {
    const labels = labelIntervals(line(11), line(11), [{ fromIndex: 2, toIndex: 4, value: 'road' }], 'unknown');
    expect(labels.map((label, i) => (i >= 2 && i < 4 ? label : 'x'))).toEqual(['x', 'x', 'road', 'road', 'x', 'x', 'x', 'x', 'x', 'x']);
    expect(labels[0]).toBe('unknown');
    expect(labelIntervals(line(5), line(5), [], 'unknown')).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('answers an empty list for a line with fewer than two vertices', () => {
    expect(labelIntervals(line(5), [[0.6, 42.6]], [], 'unknown')).toEqual([]);
    expect(labelIntervals([[0.6, 42.6]], line(3), [], 'unknown')).toEqual(['unknown', 'unknown']);
  });
});

describe('groupIntervals', () => {
  it('joins consecutive equal labels into runs that share their boundary vertex', () => {
    expect(groupIntervals(['road', 'road', 'path', 'path', 'path', 'road'])).toEqual([
      { fromIndex: 0, toIndex: 2, value: 'road' },
      { fromIndex: 2, toIndex: 5, value: 'path' },
      { fromIndex: 5, toIndex: 6, value: 'road' },
    ]);
    expect(groupIntervals([])).toEqual([]);
  });
});
