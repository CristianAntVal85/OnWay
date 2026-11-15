// El mapa sigue al tema sin volver a montarse (UI-rediseno T5, D-U2, D-U7, D-U12). jsdom no tiene WebGL: se sustituye react-map-gl por un
// doble que anota con qué estilo se pinta y cuántas veces se monta; que MapLibre de verdad conserva el canvas, las rutas y la vista al
// aplicar el estilo nuevo con `setStyle` se comprueba con Chrome DevTools y en el E2E (T9).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { es } from '@onway/i18n';
import { createI18n } from '../src/i18n';
import { ThemeProvider, useTheme } from '../src/theme/theme-context';
import type { MapRoute } from '../src/map/types';

const layerButton = (layer: string) => screen.getByRole('button', { name: es.map.layers.current.replace('{{layer}}', layer) });

const gl = vi.hoisted(() => ({ mounts: 0, unmounts: 0, styles: [] as unknown[], viewStates: [] as unknown[] }));

vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn(), addProtocol: vi.fn() }));
vi.mock('pmtiles', () => ({
  Protocol: class {
    tile = vi.fn();
  },
}));
vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const Map = React.forwardRef(function MapDouble({ mapStyle, initialViewState, children }: { mapStyle: { sprite?: string }; initialViewState: unknown; children: ReactNode }, _ref) {
    React.useEffect(() => {
      gl.mounts += 1;
      return () => {
        gl.unmounts += 1;
      };
    }, []);
    gl.styles.push(mapStyle);
    gl.viewStates.push(initialViewState);
    return (
      <div data-testid="gl" data-sprite={mapStyle.sprite ?? ''}>
        {children}
      </div>
    );
  });
  return {
    default: Map,
    Source: ({ id, children }: { id: string; children: ReactNode }) => <div data-testid={`source-${id}`}>{children}</div>,
    Layer: ({ id }: { id: string }) => <div data-testid={`layer-${id}`} />,
    Marker: ({ children }: { children: ReactNode }) => <div data-testid="marker">{children}</div>,
    NavigationControl: () => <div data-testid="navigation-control" />,
  };
});

const { default: MapView } = await import('../src/map/map-view');

const ROUTES: MapRoute[] = [
  {
    id: 'r1',
    name: 'Ruta',
    tone: 'validated',
    line: [
      [0.1, 42.6],
      [0.2, 42.7],
    ],
  },
];

function ThemeButtons() {
  const { resolved, setPreference } = useTheme();
  return (
    <div>
      <output data-testid="resolved">{resolved}</output>
      <button onClick={() => setPreference('dark')}>to-dark</button>
      <button onClick={() => setPreference('light')}>to-light</button>
    </div>
  );
}

const harness = () =>
  render(
    <I18nextProvider i18n={createI18n('es')}>
      <ThemeProvider>
        <ThemeButtons />
        <MapView defaultLayer="roads" routes={ROUTES} markers={[{ id: 'm1', kind: 'target', lat: 42.6, lon: 0.1 }]} elevationLookup={async () => 1} />
      </ThemeProvider>
    </I18nextProvider>,
  );

beforeEach(() => {
  gl.mounts = 0;
  gl.unmounts = 0;
  gl.styles = [];
  gl.viewStates = [];
  document.documentElement.removeAttribute('data-theme');
});

describe('MapView y el tema (D-U7)', () => {
  it('sin elección guardada pinta el estilo oscuro: sprites v4/dark', () => {
    harness();
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(screen.getByTestId('gl').getAttribute('data-sprite')).toMatch(/\/tiles\/assets\/sprites\/v4\/dark$/);
  });

  it('al cambiar el tema entra el estilo nuevo en el mismo mapa: no se desmonta ni se vuelve a montar, y la vista inicial no se toca', async () => {
    const user = userEvent.setup();
    harness();
    const before = screen.getByTestId('gl');
    const firstView = gl.viewStates[0];

    await user.click(screen.getByText('to-light'));
    expect(screen.getByTestId('gl').getAttribute('data-sprite')).toMatch(/sprites\/v4\/light$/);
    await user.click(screen.getByText('to-dark'));
    expect(screen.getByTestId('gl').getAttribute('data-sprite')).toMatch(/sprites\/v4\/dark$/);

    expect(gl.mounts).toBe(1);
    expect(gl.unmounts).toBe(0);
    expect(screen.getByTestId('gl')).toBe(before); // el mismo nodo
    expect(new Set(gl.viewStates).size).toBe(1);
    expect(gl.viewStates[gl.viewStates.length - 1]).toBe(firstView);
  });

  it('el estilo solo se rehace cuando cambia algo (no en cada pintado)', async () => {
    const user = userEvent.setup();
    harness();
    await user.click(screen.getByText('to-light'));
    await user.click(screen.getByText('to-light')); // misma elección: nada que cambiar
    const distinct = new Set(gl.styles);
    expect(distinct.size).toBe(2); // oscuro y claro
  });

  it('rutas, marcadores, capa activa, controles y atribuciones siguen ahí tras cambiar de tema, en los dos sentidos', async () => {
    const user = userEvent.setup();
    harness();
    const check = () => {
      expect(screen.getByTestId('layer-library-routes-line')).toBeTruthy();
      expect(screen.getByTestId('layer-library-routes-casing')).toBeTruthy();
      expect(screen.getAllByTestId('marker')).toHaveLength(1);
      expect(screen.getByRole('img', { name: es.map.markers.target })).toBeTruthy();
      expect(screen.getByTestId('navigation-control')).toBeTruthy();
      expect(layerButton(es.map.layers.roads)).toBeTruthy();
      const attribution = screen.getByRole('list', { name: es.map.attribution.label });
      expect(attribution.textContent).toContain('OpenStreetMap');
    };
    check();
    await user.click(screen.getByText('to-light'));
    check();
    await user.click(screen.getByText('to-dark'));
    check();
  });

  it('una capa de IGN que se ha elegido sigue siendo la elegida al cambiar de tema, y sin sprites', async () => {
    const user = userEvent.setup();
    harness();
    await user.click(layerButton(es.map.layers.roads));
    await user.click(screen.getByRole('menuitemradio', { name: es.map.layers.satellite }));
    expect(screen.getByTestId('gl').getAttribute('data-sprite')).toBe('');
    await user.click(screen.getByText('to-light'));
    await user.click(layerButton(es.map.layers.satellite));
    expect(screen.getByRole('menuitemradio', { name: es.map.layers.satellite }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: es.map.layers.roads }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('gl').getAttribute('data-sprite')).toBe('');
    expect(gl.mounts).toBe(1);
  });
});

describe('marco del mapa con tokens (D-U3, D-U12)', () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');
  const sheet = read('src/styles.css');
  const tokens = read('src/theme/tokens.css');

  it('los controles de MapLibre se tiñen con tokens desde styles.css, con la especificidad de .map-view (el CSS de MapLibre se carga después)', () => {
    const rule = (selector: string) => new RegExp(`${selector.replace(/[.[\]():+]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';
    const group = rule('.map-view .maplibregl-ctrl-group');
    expect(group).toMatch(/background:\s*var\(--surface-raised\)/);
    expect(rule('.map-view .maplibregl-ctrl-group:not(:empty)')).toMatch(/box-shadow:\s*0 0 0 2px var\(--border-strong\)/);
    expect(rule('.map-view .maplibregl-ctrl-group button + button')).toMatch(/border-top:\s*1px solid var\(--border-strong\)/);
    expect(rule('.map-view .maplibregl-ctrl-group button:focus:focus-visible')).toMatch(/outline:\s*3px solid var\(--focus\)/);
    expect(rule('.map-view .maplibregl-ctrl-group .maplibregl-ctrl-icon')).toMatch(/filter:\s*var\(--map-ctrl-icon-filter\)/);
    // No cambian de tamaño (los botones de zoom de 29 px son de H7).
    expect(sheet).not.toMatch(/\.maplibregl-ctrl[^{]*\{[^}]*(?:width|height)\s*:/);
  });

  it('el filtro de los iconos es un token de cada tema: se invierten en oscuro y no en claro', () => {
    expect(/:root,\s*\[data-theme='dark'\]\s*\{[^}]*--map-ctrl-icon-filter:\s*invert\(1\)/.test(tokens)).toBe(true);
    expect(/\[data-theme='light'\]\s*\{[^}]*--map-ctrl-icon-filter:\s*none/.test(tokens)).toBe(true);
  });
});
