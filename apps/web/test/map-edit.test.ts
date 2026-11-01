// Edición de vértices (H2-T9): añadir, mover, insertar, borrar y deshacer; tramo más cercano y simplificado. Todo vive en `src/map/edit.ts`.
import { describe, expect, it } from 'vitest';
import { editReducer, initialEdit, nearestSegment, simplifyVertices, type EditState, type Vertex } from '../src/map/edit';

const v = (lon: number, lat: number): Vertex => [lon, lat];
const run = (state: EditState, ...actions: Parameters<typeof editReducer>[1][]) => actions.reduce(editReducer, state);

describe('editReducer', () => {
  it('añade vértices al final y elige el último', () => {
    const state = run(initialEdit(), { type: 'append', point: v(0, 42) }, { type: 'append', point: v(0.1, 42.1) });
    expect(state.vertices).toEqual([v(0, 42), v(0.1, 42.1)]);
    expect(state.selected).toBe(1);
  });

  it('mover cambia solo ese vértice; insertar lo mete en su sitio; borrar lo quita y deja sin elegir', () => {
    let state = run(initialEdit([v(0, 42), v(1, 42), v(2, 42)]), { type: 'move', index: 1, point: v(1, 43) });
    expect(state.vertices).toEqual([v(0, 42), v(1, 43), v(2, 42)]);
    state = run(state, { type: 'insert', index: 1, point: v(0.5, 42.5) });
    expect(state.vertices.map((p) => p[0])).toEqual([0, 0.5, 1, 2]);
    expect(state.selected).toBe(1);
    state = run(state, { type: 'remove', index: 0 });
    expect(state.vertices.map((p) => p[0])).toEqual([0.5, 1, 2]);
    expect(state.selected).toBeNull();
  });

  it('deshacer vuelve atrás paso a paso y no hace nada cuando no hay historia', () => {
    const start = initialEdit([v(0, 42), v(1, 42)]);
    let state = run(start, { type: 'append', point: v(2, 42) }, { type: 'move', index: 0, point: v(9, 9) }, { type: 'remove', index: 1 });
    expect(state.vertices).toEqual([v(9, 9), v(2, 42)]);
    state = run(state, { type: 'undo' });
    expect(state.vertices).toEqual([v(9, 9), v(1, 42), v(2, 42)]);
    state = run(state, { type: 'undo' }, { type: 'undo' });
    expect(state.vertices).toEqual(start.vertices);
    expect(run(state, { type: 'undo' })).toBe(state);
  });

  it('un índice fuera de rango no cambia nada y elegir no entra en el historial', () => {
    const state = initialEdit([v(0, 42), v(1, 42)]);
    expect(run(state, { type: 'move', index: 5, point: v(0, 0) })).toBe(state);
    expect(run(state, { type: 'remove', index: -1 })).toBe(state);
    const chosen = run(state, { type: 'select', index: 1 });
    expect(chosen.selected).toBe(1);
    expect(chosen.history).toEqual([]);
    expect(run(chosen, { type: 'select', index: 7 }).selected).toBeNull();
  });

  it('reset parte de cero y la historia tiene tope', () => {
    let state = initialEdit([v(0, 0), v(1, 1)]);
    for (let i = 0; i < 150; i++) state = run(state, { type: 'append', point: v(i, 0) });
    expect(state.history.length).toBe(100);
    expect(run(state, { type: 'reset', vertices: [v(5, 5)] })).toEqual({ vertices: [v(5, 5)], selected: null, history: [] });
  });
});

describe('nearestSegment', () => {
  const line = [v(0, 42), v(0.01, 42), v(0.01, 42.01)];
  it('elige el tramo más cercano al punto', () => {
    expect(nearestSegment(line, v(0.005, 42.0004))).toBe(0);
    expect(nearestSegment(line, v(0.0104, 42.005))).toBe(1);
    expect(nearestSegment([v(0, 0)], v(1, 1))).toBeNull();
  });
});

describe('simplifyVertices', () => {
  const wiggle = Array.from({ length: 2000 }, (_, i) => v(0.2 + i * 0.00005, 42.4 + Math.sin(i / 25) * 0.003));
  it('deja como mucho `max` vértices y conserva los dos extremos', () => {
    for (const max of [10, 50, 150]) {
      const result = simplifyVertices(wiggle, max);
      expect(result.length).toBeLessThanOrEqual(max);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]).toEqual(wiggle[0]);
      expect(result.at(-1)).toEqual(wiggle.at(-1));
    }
  });

  it('no toca lo que ya cabe y devuelve copias', () => {
    const short = [v(0, 42), v(1, 42), v(2, 43)];
    const result = simplifyVertices(short, 150);
    expect(result).toEqual(short);
    expect(result[0]).not.toBe(short[0]);
  });
});
