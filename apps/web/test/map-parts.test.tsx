// Piezas del módulo del mapa que no necesitan WebGL: indicador de coordenadas y altitud, atribuciones y estilos (T6, RF-302, RF-304, D-H1-09, D-H1-17).
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { es } from '@onway/i18n';
import { createI18n } from '../src/i18n';
import { Attribution, attributionKeys } from '../src/map/attribution';
import { ES_ORTHO, ES_TOPO, FR_ORTHO, FR_STRIPS, FR_TOPO, IGN_HOSTS } from '../src/map/ign';
import {
  NO_DATA_DETAIL,
  SATELLITE_TILES,
  TOPOGRAPHIC_TILES,
  detailOf,
  frenchTopoUrl,
  frenchUrl,
  keyOutBlank,
  keyOutFlatBlocks,
  parseTileUrl,
  sourcesFor,
  spanishTopoUrl,
  spanishUrl,
  tileBounds,
} from '../src/map/ign-mix';
import { Readout } from '../src/map/readout';
import { namedFlavor } from '@protomaps/basemaps';
import { buildStyle } from '../src/map/style';
import { PYRENEES_BOUNDS, initialViewFor } from '../src/map/view';

const wrap = (node: React.ReactNode) => render(<I18nextProvider i18n={createI18n('es')}>{node}</I18nextProvider>);

describe('indicador de coordenadas y altitud (RF-302)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sin posición muestra la ayuda; sin función de altitud (rescatista) solo habla de coordenadas', () => {
    wrap(<Readout cursor={null} lookup={async () => 1} />);
    expect(screen.getByText(es.map.cursor.hint)).toBeTruthy();
    wrap(<Readout cursor={null} />);
    expect(screen.getByText(es.map.cursor.hintNoElevation)).toBeTruthy();
  });

  it('pinta las coordenadas al momento y pide la altitud solo cuando el cursor se detiene ~300 ms', async () => {
    const lookup = vi.fn(async () => 1820);
    const view = wrap(<Readout cursor={{ lat: 42.6335, lon: 0.1021, immediate: false }} lookup={lookup} />);
    expect(screen.getByText('42.63350, 0.10210')).toBeTruthy();
    expect(screen.getByText(es.map.cursor.elevationLoading)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(lookup).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Altitud 1\.?820 m/)).toBeTruthy();

    // El cursor se mueve de nuevo antes de detenerse: solo cuenta la última posición.
    view.rerender(
      <I18nextProvider i18n={createI18n('es')}>
        <Readout cursor={{ lat: 42.7, lon: 0.2, immediate: false }} lookup={lookup} />
      </I18nextProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(100));
    view.rerender(
      <I18nextProvider i18n={createI18n('es')}>
        <Readout cursor={{ lat: 42.8, lon: 0.3, immediate: false }} lookup={lookup} />
      </I18nextProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenLastCalledWith({ lat: 42.8, lon: 0.3 });
  });

  it('un toque pide la altitud al momento; si no hay dato o falla, lo dice sin romper', async () => {
    const none = vi.fn(async () => null);
    wrap(<Readout cursor={{ lat: 10, lon: 10, immediate: true }} lookup={none} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(none).toHaveBeenCalledTimes(1);
    expect(screen.getByText(es.map.cursor.elevationNone)).toBeTruthy();
  });

  it('con el límite de uso (la petición falla) muestra «sin dato» y no lanza', async () => {
    const failing = vi.fn(async () => {
      throw new Error('RATE_LIMITED');
    });
    wrap(<Readout cursor={{ lat: 42.6, lon: 0.1, immediate: true }} lookup={failing} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText(es.map.cursor.elevationNone)).toBeTruthy();
  });

  it('sin función de altitud no la pide ni la muestra', async () => {
    wrap(<Readout cursor={{ lat: 42.6335, lon: 0.1021, immediate: true }} />);
    expect(screen.getByText('42.63350, 0.10210')).toBeTruthy();
    expect(screen.queryByText(/Altitud/)).toBeNull();
  });
});

describe('atribuciones siempre visibles (doc 04 §8.5, D-H1-17)', () => {
  it('cada capa cita lo suyo; Copernicus solo si hay altitud derivada del modelo', () => {
    expect(attributionKeys('roads', false)).toEqual(['osm']);
    expect(attributionKeys('satellite', false)).toEqual(['ignEsSatellite', 'ignFr']);
    expect(attributionKeys('topographic', true)).toEqual(['ignEs', 'ignFr', 'copernicus']);
  });

  it('están en la página, no tras un botón', () => {
    wrap(<Attribution layer="topographic" withElevation />);
    const list = screen.getByRole('list', { name: es.map.attribution.label });
    expect(list.textContent).toContain('Instituto Geográfico Nacional');
    expect(list.textContent).toContain('IGN');
    expect(list.textContent).toContain('Copernicus');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('estilos de las capas (RF-301)', () => {
  const hostsOf = (templates: string[]) => [...new Set(templates.map((u) => new URL(u.replace(/[{}]/g, '')).host))].sort();

  it('el topográfico pide por el protocolo propio y sus dos fuentes son los dos anfitriones de IGN, con sus capas verificadas', () => {
    const style = buildStyle('topographic', 'es', 'http://x.test', 'dark');
    expect(style.sources['topographic']).toMatchObject({ type: 'raster', tiles: [TOPOGRAPHIC_TILES] });
    expect(hostsOf([ES_TOPO, FR_TOPO])).toEqual([...IGN_HOSTS].sort());
    expect(ES_TOPO).toContain('layer=MTN');
    expect(FR_TOPO).toContain('LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2');
  });

  it('el satélite pide por el protocolo propio y sus dos fuentes son las capas verificadas de IGN', () => {
    const style = buildStyle('satellite', 'es', 'http://x.test', 'dark');
    expect(style.sources['satellite']).toMatchObject({ type: 'raster', tiles: [SATELLITE_TILES] });
    expect(hostsOf([ES_ORTHO, FR_ORTHO])).toEqual([...IGN_HOSTS].sort());
    expect(ES_ORTHO).toContain('layer=OI.OrthoimageCoverage');
    expect(FR_ORTHO).toContain('LAYER=ORTHOIMAGERY.ORTHOPHOTOS');
  });

  it('topográfico: una sola capa compuesta por tesela (el MTN español encima del Plan IGN), no franjas apiladas', () => {
    const style = buildStyle('topographic', 'es', 'http://x.test', 'dark');
    expect(style.layers.map((l) => l.id)).toEqual(['background', 'topographic']);
  });

  it('las franjas francesas se tocan sin huecos de longitud y cubren la caja de los Pirineos al norte de la frontera', () => {
    for (let i = 1; i < FR_STRIPS.length; i += 1) expect(FR_STRIPS[i]![0]).toBe(FR_STRIPS[i - 1]![2]);
    const covered = (lat: number, lon: number) => FR_STRIPS.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
    for (const [lat, lon] of [
      [43.4, -1.7],
      [43.0, -1.2],
      [42.75, -0.01],
      [42.8, 1.0],
      [42.5, 2.0],
      [42.6, 2.9],
      [44, 3.9],
    ] as const)
      expect(covered(lat, lon), `${lat},${lon}`).toBe(true);
  });

  it('carreteras = PMTiles propio del mismo origen, con fuentes y sprites propios; el idioma sale de la interfaz', () => {
    const style = buildStyle('roads', 'fr', 'https://onway.test', 'light');
    expect(style.sources['protomaps']).toMatchObject({ type: 'vector', url: 'pmtiles://https://onway.test/tiles/pyrenees.pmtiles' });
    expect(style.glyphs).toBe('https://onway.test/tiles/assets/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('https://onway.test/tiles/assets/sprites/v4/light');
    expect(style.layers.length).toBeGreaterThan(20);
    expect(JSON.stringify(style)).toContain('name:fr');
  });
});

describe('el mapa de carreteras sigue al tema (UI-rediseno T5, D-U2, D-U7)', () => {
  const roads = (theme: 'dark' | 'light') => buildStyle('roads', 'es', 'https://onway.test', theme);
  const paintOf = (style: ReturnType<typeof roads>, id: string) => (style.layers.find((layer) => layer.id === id) as { paint?: Record<string, unknown> } | undefined)?.paint;

  it('en oscuro pide los sprites v4/dark y pinta con el sabor oscuro de Protomaps', () => {
    const style = roads('dark');
    expect(style.sprite).toBe('https://onway.test/tiles/assets/sprites/v4/dark');
    expect(paintOf(style, 'background')?.['background-color']).toBe(namedFlavor('dark').background);
    expect(JSON.stringify(style)).toContain(namedFlavor('dark').water);
    expect(JSON.stringify(style)).not.toContain(namedFlavor('light').water);
  });

  it('en claro pide los sprites v4/light y pinta con el sabor claro', () => {
    const style = roads('light');
    expect(style.sprite).toBe('https://onway.test/tiles/assets/sprites/v4/light');
    expect(paintOf(style, 'background')?.['background-color']).toBe(namedFlavor('light').background);
    expect(JSON.stringify(style)).toContain(namedFlavor('light').water);
  });

  it('solo cambian los sprites y los colores: mismas fuentes, tipografías y capas, en el mismo orden', () => {
    const dark = roads('dark');
    const light = roads('light');
    expect(dark.sources).toEqual(light.sources);
    expect(dark.glyphs).toBe(light.glyphs);
    expect(dark.layers.map((layer) => layer.id)).toEqual(light.layers.map((layer) => layer.id));
    expect(JSON.stringify(dark)).not.toBe(JSON.stringify(light));
  });

  it('satélite y topográfico no se tematizan: mismas fuentes y capas en los dos temas; solo el fondo de relleno sigue al tema', () => {
    for (const layer of ['satellite', 'topographic'] as const) {
      const dark = buildStyle(layer, 'es', 'http://x.test', 'dark');
      const light = buildStyle(layer, 'es', 'http://x.test', 'light');
      expect(dark.sources).toEqual(light.sources);
      expect(dark.layers.map((l) => l.id)).toEqual(light.layers.map((l) => l.id));
      expect(dark.layers.filter((l) => l.type === 'raster')).toEqual(light.layers.filter((l) => l.type === 'raster'));
      expect(dark.sprite).toBeUndefined();
      expect(paintOf(dark, 'background')?.['background-color']).toBe(namedFlavor('dark').background);
      expect(paintOf(light, 'background')?.['background-color']).toBe(namedFlavor('light').background);
    }
  });
});

describe('satélite compuesto por tesela (RF-304)', () => {
  // Tesela del zoom 14 que contiene un punto.
  const tileAt = (lat: number, lon: number, z = 14) => {
    const n = 2 ** z;
    return { z, x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n) };
  };

  it('tileBounds contiene el punto de la tesela y mide lo que debe', () => {
    const [w, s, e, n] = tileBounds(tileAt(42.7, -0.01));
    expect(w).toBeLessThanOrEqual(-0.01);
    expect(e).toBeGreaterThan(-0.01);
    expect(s).toBeLessThanOrEqual(42.7);
    expect(n).toBeGreaterThan(42.7);
    expect(e - w).toBeCloseTo(360 / 2 ** 14, 9);
    expect(tileBounds({ z: 0, x: 0, y: 0 })).toEqual([-180, expect.closeTo(-85.0511, 3), 180, expect.closeTo(85.0511, 3)]);
  });

  it('pide a cada fuente solo las teselas que toca: Francia sola al norte, España sola al sur, las dos en la frontera', () => {
    expect(sourcesFor(tileAt(46.5, 2.5))).toEqual({ spanish: false, french: true }); // centro de Francia
    expect(sourcesFor(tileAt(40.4, -3.7))).toEqual({ spanish: true, french: false }); // Madrid
    expect(sourcesFor(tileAt(42.7, -0.01))).toEqual({ spanish: true, french: true }); // Gavarnie
    expect(sourcesFor(tileAt(43.3, -0.37))).toEqual({ spanish: true, french: true }); // Pau
    expect(sourcesFor(tileAt(52, 20))).toEqual({ spanish: false, french: false }); // fuera de las dos
  });

  it('lee la dirección de la tesela y rellena las plantillas de cada servicio', () => {
    expect(parseTileUrl('ign-sat://tiles/14/8193/6041')).toEqual({ z: 14, x: 8193, y: 6041 });
    expect(parseTileUrl('ign-topo://tiles/14/8193/6041')).toEqual({ z: 14, x: 8193, y: 6041 });
    expect(parseTileUrl('ign-sat://tiles/14/8193')).toBeNull();
    expect(spanishTopoUrl({ z: 15, x: 16, y: 17 })).toContain('layer=MTN&style=default&format=image/jpeg&tilematrixset=GoogleMapsCompatible&tilematrix=15&tilerow=17&tilecol=16');
    expect(frenchTopoUrl({ z: 15, x: 16, y: 17 })).toContain('LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2');
    expect(frenchTopoUrl({ z: 15, x: 16, y: 17 })).toContain('TILEMATRIX=15&TILEROW=17&TILECOL=16');
    expect(spanishUrl({ z: 14, x: 8193, y: 6041 })).toBe(
      'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg&tilematrixset=GoogleMapsCompatible&tilematrix=14&tilerow=6041&tilecol=8193',
    );
    expect(frenchUrl({ z: 14, x: 8193, y: 6041 })).toContain('TILEMATRIX=14&TILEROW=6041&TILECOL=8193');
  });

  it('el relieve de relleno del MTN fuera de su cobertura (liso) se distingue de un mapa real, y una tesela lisa sin nada debajo no es «sin datos»', () => {
    const rgba = (value: (index: number) => number) => {
      const data = new Uint8ClampedArray(256 * 256 * 4);
      for (let i = 0; i < 256 * 256; i += 1) data.set([value(i), value(i), value(i), 255], i * 4);
      return data;
    };
    expect(detailOf(rgba(() => 200))).toBe(0); // liso (mar, lago o relleno)
    expect(detailOf(rgba((i) => 200 - Math.floor(i / 256) / 8))).toBeLessThan(NO_DATA_DETAIL); // degradado suave: relleno
    expect(detailOf(rgba((i) => (i % 8 < 4 ? 40 : 220)))).toBeGreaterThan(NO_DATA_DETAIL); // líneas y rótulos: mapa real
  });

  it('en una tesela del borde de la cobertura solo se quitan los bloques de relleno, no los de mapa real', () => {
    const data = new Uint8ClampedArray(256 * 256 * 4);
    for (let row = 0; row < 256; row += 1)
      for (let column = 0; column < 256; column += 1) {
        const value = column < 128 ? (column % 8 < 4 ? 40 : 220) : 200; // izquierda: líneas de mapa; derecha: relleno liso
        data.set([value, value, value, 255], (row * 256 + column) * 4);
      }
    expect(keyOutFlatBlocks(data)).toBe(32); // 4 columnas de bloques × 8 filas
    expect(data[(10 * 256 + 10) * 4 + 3]).toBe(255); // mapa real
    expect(data[(10 * 256 + 200) * 4 + 3]).toBe(0); // relleno
  });

  it('el blanco puro de «sin datos» se hace transparente y la imagen real no se toca', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, /* sin datos */ 254, 253, 255, 255, /* casi blanco (JPEG) */ 120, 130, 90, 255, /* imagen */ 255, 255, 200, 255 /* nieve amarillenta */]);
    expect(keyOutBlank(rgba)).toBe(2);
    expect([rgba[3], rgba[7], rgba[11], rgba[15]]).toEqual([0, 0, 255, 255]);
  });
});

describe('encuadre inicial del mapa (T7)', () => {
  it('sin marcadores, los Pirineos; con uno, centrado en él; con varios, la caja que los contiene', () => {
    expect(initialViewFor([])).toMatchObject({ bounds: PYRENEES_BOUNDS });
    expect(initialViewFor([{ lat: 42.6, lon: 0.65 }])).toEqual({ longitude: 0.65, latitude: 42.6, zoom: 12 });
    expect(
      initialViewFor([
        { lat: 42.6, lon: 0.65 },
        { lat: 42.6, lon: 0.65 },
      ]),
    ).toEqual({ longitude: 0.65, latitude: 42.6, zoom: 12 });
    expect(
      initialViewFor([
        { lat: 42.6, lon: 0.65 },
        { lat: 42.7, lon: 0.5 },
        { lat: 42.5, lon: 0.9 },
      ]),
    ).toMatchObject({ bounds: [0.5, 42.5, 0.9, 42.7], fitBoundsOptions: { maxZoom: 14 } });
  });
});
