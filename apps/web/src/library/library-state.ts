// El estado de la biblioteca vive en la dirección (filtros, orden, página, vista): «atrás» y los enlaces funcionan.
// La zona del mapa y la selección viven en la página: dependen de lo que se ve, no de un enlace.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

export const SORTS = ['updated_desc', 'name_asc', 'distance_asc', 'distance_desc', 'ascent_desc'] as const;
export type Sort = (typeof SORTS)[number];
export const VALIDATED_DAYS = [7, 30, 90] as const;
export const VIEWS = ['list', 'map'] as const;
export type View = (typeof VIEWS)[number];
export const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

export interface LibraryFilters {
  q: string;
  status: 'active' | 'archived';
  versionStatus: '' | 'draft' | 'validated';
  minKm: number | null;
  maxKm: number | null;
  minAscent: number | null;
  maxAscent: number | null;
  validatedDays: number | null;
  sort: Sort;
  page: number;
}

const positive = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export function parseFilters(params: URLSearchParams): LibraryFilters {
  const page = Number(params.get('page'));
  const days = Number(params.get('validated'));
  const sort = SORTS.find((id) => id === params.get('sort')) ?? 'updated_desc';
  const version = params.get('version');
  return {
    q: params.get('q') ?? '',
    status: params.get('status') === 'archived' ? 'archived' : 'active',
    versionStatus: version === 'draft' || version === 'validated' ? version : '',
    minKm: positive(params.get('minKm')),
    maxKm: positive(params.get('maxKm')),
    minAscent: positive(params.get('minAscent')),
    maxAscent: positive(params.get('maxAscent')),
    validatedDays: (VALIDATED_DAYS as readonly number[]).includes(days) ? days : null,
    sort,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Filtros activos distintos de los de salida (sin contar el orden ni la página). */
export const activeFilterCount = (f: LibraryFilters): number =>
  [f.q !== '', f.status !== 'active', f.versionStatus !== '', f.minKm !== null, f.maxKm !== null, f.minAscent !== null, f.maxAscent !== null, f.validatedDays !== null].filter(Boolean).length;

/** Parámetros de `listRoutes` a partir de los filtros y, si la hay, la zona elegida del mapa. */
export function listQuery(f: LibraryFilters, bbox: string | null) {
  return {
    status: f.status,
    sort: f.sort,
    page: f.page,
    pageSize: PAGE_SIZE,
    ...(f.q ? { q: f.q } : {}),
    ...(f.versionStatus ? { versionStatus: f.versionStatus } : {}),
    ...(f.minKm !== null ? { minDistanceM: Math.round(f.minKm * 1000) } : {}),
    ...(f.maxKm !== null ? { maxDistanceM: Math.round(f.maxKm * 1000) } : {}),
    ...(f.minAscent !== null ? { minAscentM: f.minAscent } : {}),
    ...(f.maxAscent !== null ? { maxAscentM: f.maxAscent } : {}),
    ...(f.validatedDays !== null ? { validatedWithinDays: f.validatedDays } : {}),
    ...(bbox ? { bbox } : {}),
  };
}

export function useLibraryState() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  // La vista (Lista o Mapa) es un estado propio y se refleja en la dirección: el cambio de pestaña no espera a que el enrutador
  // termine de navegar (en un equipo lento podía tardar y la pestaña parecía no responder).
  const [chosen, setChosen] = useState<View>(params.get('view') === 'map' ? 'map' : 'list');
  const fromUrl: View = params.get('view') === 'map' ? 'map' : 'list';
  const urlSeen = useRef(fromUrl);
  if (urlSeen.current !== fromUrl) {
    // «Atrás» o un enlace cambian la dirección por fuera: la pestaña los sigue.
    urlSeen.current = fromUrl;
    setChosen(fromUrl);
  }
  const view = chosen;

  // Cada cambio parte de lo último que se pidió, no de lo que se pintó: dos cambios seguidos (escribir y, enseguida, elegir un filtro)
  // no se pisan aunque React Router aún no haya vuelto a pintar entre uno y otro.
  const latest = useRef(params);
  latest.current = params;
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(latest.current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    latest.current = next;
    setParams(next, { replace: true });
  };

  // La búsqueda por nombre se aplica al dejar de teclear (o al enviarla); cambiarla vuelve a la página 1.
  const [draft, setDraft] = useState(filters.q);
  useEffect(() => setDraft(filters.q), [filters.q]);
  useEffect(() => {
    const text = draft.trim();
    if (text === filters.q) return;
    const timer = setTimeout(() => update({ q: text, page: null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // `update` cambia en cada render; solo importa lo que se ha escrito.
  }, [draft, filters.q]);

  return {
    filters,
    view,
    setView: (next: View) => {
      setChosen(next);
      update({ view: next === 'list' ? null : next });
    },
    draft,
    setDraft,
    update,
    clear: () => {
      latest.current = new URLSearchParams(chosen === 'map' ? { view: 'map' } : {});
      setParams(latest.current, { replace: true });
    },
  };
}
