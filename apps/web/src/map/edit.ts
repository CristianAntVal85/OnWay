// Edición a mano de una ruta (RF-505, RF-516): vértices que se añaden, se arrastran, se insertan y se borran, con «deshacer».
// Geometría de mapa: vive aquí (regla inviolable 9). Solo hay vértices `[lon, lat]`: la altitud y las métricas las pone el servidor.
export type Vertex = [lon: number, lat: number];

export interface EditState {
  vertices: Vertex[];
  selected: number | null;
  /** Estados anteriores de `vertices`, el último al final. */
  history: Vertex[][];
}

export type EditAction =
  | { type: 'append'; point: Vertex }
  | { type: 'move'; index: number; point: Vertex }
  | { type: 'insert'; index: number; point: Vertex }
  | { type: 'remove'; index: number }
  | { type: 'select'; index: number | null }
  | { type: 'undo' }
  | { type: 'reset'; vertices: Vertex[] };

const HISTORY_LIMIT = 100;

export const initialEdit = (vertices: Vertex[] = []): EditState => ({ vertices, selected: null, history: [] });

const remember = (state: EditState, vertices: Vertex[], selected: number | null): EditState => ({ vertices, selected, history: [...state.history, state.vertices].slice(-HISTORY_LIMIT) });

export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'append':
      return remember(state, [...state.vertices, action.point], state.vertices.length);
    case 'move':
      if (action.index < 0 || action.index >= state.vertices.length) return state;
      return remember(
        state,
        state.vertices.map((vertex, i) => (i === action.index ? action.point : vertex)),
        action.index,
      );
    case 'insert': {
      const at = Math.min(Math.max(action.index, 0), state.vertices.length);
      return remember(state, [...state.vertices.slice(0, at), action.point, ...state.vertices.slice(at)], at);
    }
    case 'remove':
      if (action.index < 0 || action.index >= state.vertices.length) return state;
      return remember(
        state,
        state.vertices.filter((_, i) => i !== action.index),
        null,
      );
    case 'select':
      return { ...state, selected: action.index !== null && action.index >= 0 && action.index < state.vertices.length ? action.index : null };
    case 'undo': {
      const previous = state.history.at(-1);
      return previous ? { vertices: previous, selected: null, history: state.history.slice(0, -1) } : state;
    }
    case 'reset':
      return initialEdit(action.vertices);
  }
}

const METERS_PER_DEGREE = 111_320;

/** Metros (aprox., plano local) entre dos vértices: basta para elegir el tramo más cercano a un clic. */
function planar(a: Vertex, b: Vertex, cosLat: number): [number, number] {
  return [(b[0] - a[0]) * cosLat * METERS_PER_DEGREE, (b[1] - a[1]) * METERS_PER_DEGREE];
}

/** Distancia en metros de un punto a un segmento y posición del pie de la perpendicular. */
function distanceToSegment(point: Vertex, a: Vertex, b: Vertex): number {
  const cosLat = Math.cos((point[1] * Math.PI) / 180);
  const [bx, by] = planar(a, b, cosLat);
  const [px, py] = planar(a, point, cosLat);
  const length2 = bx * bx + by * by;
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / length2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Índice del tramo (de `i` a `i + 1`) más cercano al punto, o `null` si no hay tramos. */
export function nearestSegment(vertices: readonly Vertex[], point: Vertex): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < vertices.length; i++) {
    const distance = distanceToSegment(point, vertices[i]!, vertices[i + 1]!);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** Douglas-Peucker con la tolerancia que haga falta para dejar como mucho `max` vértices, conservando los dos extremos. */
export function simplifyVertices(vertices: readonly Vertex[], max: number): Vertex[] {
  if (vertices.length <= max) return vertices.map((v) => [v[0], v[1]]);
  const run = (tolerance: number): Vertex[] => {
    const keep = new Array<boolean>(vertices.length).fill(false);
    keep[0] = keep[vertices.length - 1] = true;
    const stack: [number, number][] = [[0, vertices.length - 1]];
    while (stack.length > 0) {
      const [from, to] = stack.pop()!;
      let far = -1;
      let farDistance = tolerance;
      for (let i = from + 1; i < to; i++) {
        const distance = distanceToSegment(vertices[i]!, vertices[from]!, vertices[to]!);
        if (distance > farDistance) {
          far = i;
          farDistance = distance;
        }
      }
      if (far >= 0) {
        keep[far] = true;
        stack.push([from, far], [far, to]);
      }
    }
    return vertices.filter((_, i) => keep[i]).map((v) => [v[0], v[1]]);
  };
  // Se sube la tolerancia (duplicando) hasta que cabe; nunca pasa de los pocos kilómetros de una ruta de montaña.
  let tolerance = 1;
  let result = run(tolerance);
  while (result.length > max && tolerance < 100_000) {
    tolerance *= 2;
    result = run(tolerance);
  }
  return result.length > max ? result.filter((_, i) => i % Math.ceil(result.length / max) === 0 || i === result.length - 1).slice(0, max) : result;
}
