import { haversineM } from './geometry.js';

/** A label (a road type) over the vertices `fromIndex` to `toIndex` of a line, both included. */
export interface LabelledStretch<T> {
  fromIndex: number;
  toIndex: number;
  value: T;
}

/** A run of consecutive intervals of the prepared line with the same label: the vertices `fromIndex` to `toIndex`. */
export interface Run<T> {
  fromIndex: number;
  toIndex: number;
  value: T;
}

const cumulative = (line: readonly (readonly number[])[]): number[] => {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + haversineM(line[i - 1]!, line[i]!));
  return out;
};

/**
 * Carries labels from one line to another that follows the same path with other vertices (D-H3-04). The routing engine labels its own
 * vertices; the server stores the line it has rounded, thinned and densified. Both are measured along the line, as a share of its
 * length, so the labels land on the same place however many vertices each has. Returns one label per interval of `prepared`
 * (`prepared.length - 1`), taken at the middle of the interval; an interval no stretch covers gets `fallback`.
 */
export function labelIntervals<T>(original: readonly (readonly number[])[], prepared: readonly (readonly number[])[], stretches: readonly LabelledStretch<T>[], fallback: T): T[] {
  const intervals = Math.max(0, prepared.length - 1);
  if (original.length < 2 || intervals === 0) return Array.from({ length: intervals }, () => fallback);
  const from = cumulative(original);
  const to = cumulative(prepared);
  const originalTotal = from[from.length - 1]!;
  const preparedTotal = to[to.length - 1]!;
  if (!(originalTotal > 0) || !(preparedTotal > 0)) return Array.from({ length: intervals }, () => fallback);

  const bounds = stretches.map((stretch) => ({ start: from[stretch.fromIndex]! / originalTotal, end: from[stretch.toIndex]! / originalTotal, value: stretch.value }));
  const labels: T[] = [];
  let cursor = 0;
  for (let i = 0; i < intervals; i++) {
    const middle = (to[i]! + to[i + 1]!) / 2 / preparedTotal;
    // The middles grow, so the search never goes back.
    while (cursor < bounds.length - 1 && middle > bounds[cursor]!.end) cursor++;
    const bound = bounds[cursor];
    labels.push(bound && middle >= bound.start - 1e-9 && middle <= bound.end + 1e-9 ? bound.value : fallback);
  }
  return labels;
}

/** Joins consecutive intervals with the same label into runs over the vertices (a run ends on the vertex where the next one starts). */
export function groupIntervals<T>(labels: readonly T[]): Run<T>[] {
  const runs: Run<T>[] = [];
  labels.forEach((value, index) => {
    const last = runs[runs.length - 1];
    if (last && last.value === value) last.toIndex = index + 1;
    else runs.push({ fromIndex: index, toIndex: index + 1, value });
  });
  return runs;
}
