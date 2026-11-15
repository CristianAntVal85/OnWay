// Menú desplegable común (UI-simplificacion T2, D-S5): patrón de menú de acciones con teclado completo.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItem } from '../src/components/menu';
import { ICON_NAMES, Icon } from '../src/components/icon';
import { TextField } from '../src/components/text-field';
import { Segmented } from '../src/components/segmented';

function setup(items?: MenuItem[], props: Partial<Parameters<typeof Menu>[0]> = {}) {
  const onGpx = vi.fn();
  const onKml = vi.fn();
  const onArchive = vi.fn();
  const list = items ?? [
    { id: 'gpx', label: 'GPX', onSelect: onGpx },
    { id: 'kml', label: 'KML', onSelect: onKml },
    { id: 'archive', label: 'Archivar', onSelect: onArchive, danger: true },
  ];
  render(
    <MemoryRouter>
      <button type="button">antes</button>
      <Menu label="Exportar" items={list} {...props} />
      <button type="button">después</button>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'Exportar' }), onGpx, onKml, onArchive };
}

describe('Menu', () => {
  it('cerrado no pinta la lista y el botón lo anuncia', () => {
    const { trigger } = setup();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('se abre con clic y el foco entra en la primera opción', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Exportar' })).toBeTruthy();
    expect(trigger.getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'GPX' }));
  });

  it('se abre con Enter y con flecha abajo en la primera opción, y con flecha arriba en la última', async () => {
    const { user, trigger } = setup();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'GPX' }));
    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'GPX' }));
    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archivar' }));
  });

  it('las flechas recorren en círculo; Inicio y Fin saltan a los extremos', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'KML' }));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'GPX' }));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archivar' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'GPX' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archivar' }));
  });

  it('elegir una opción la ejecuta una vez, cierra y devuelve el foco al botón', async () => {
    const { user, trigger, onKml, onGpx } = setup();
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onKml).toHaveBeenCalledTimes(1);
    expect(onGpx).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'GPX' }));
    expect(onGpx).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape cierra sin ejecutar nada y devuelve el foco al botón', async () => {
    const { user, trigger, onGpx } = setup();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onGpx).not.toHaveBeenCalled();
  });

  it('se cierra al pulsar fuera, al salir con Tab y al volver a pulsar el botón', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'antes' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('una opción desactivada se anuncia y no hace nada', async () => {
    const onSelect = vi.fn();
    const { user, trigger } = setup([{ id: 'x', label: 'Validar', onSelect, disabled: true }]);
    await user.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Validar' });
    expect(item?.getAttribute('aria-disabled')).toBe('true');
    await user.click(item);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('una opción con destino es un enlace', async () => {
    const { user, trigger } = setup([{ id: 'gen', label: 'Generar', to: '/routes/generate' }]);
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Generar' })?.getAttribute('href')).toBe('/routes/generate');
  });

  it('menú de elección: opciones `menuitemradio` con la vigente marcada, y el foco entra en ella', async () => {
    const onRoads = vi.fn();
    const { user, trigger } = setup(
      [
        { id: 'sat', label: 'Satélite', checked: false },
        { id: 'topo', label: 'Topográfico', checked: true },
        { id: 'roads', label: 'Carreteras', checked: false, onSelect: onRoads },
      ],
      { selection: true },
    );
    await user.click(trigger);
    const topo = screen.getByRole('menuitemradio', { name: 'Topográfico' });
    expect(topo?.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Satélite' })?.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(topo);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onRoads).toHaveBeenCalledTimes(1);
  });

  it('con solo icono, el rótulo es el nombre accesible del botón', () => {
    render(<Menu label="Más acciones" icon="more" iconOnly items={[{ id: 'a', label: 'Archivar' }]} />);
    const trigger = screen.getByRole('button', { name: 'Más acciones' });
    expect(trigger?.getAttribute('aria-label')).toBe('Más acciones');
    expect(trigger.querySelector('svg[data-icon="more"]')).not.toBeNull();
  });
});

describe('Icon', () => {
  it('cada icono es decorativo y no recibe el foco', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.childElementCount, name).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('TextField', () => {
  it('etiqueta encima, sin ayuda, y el error asociado al campo', () => {
    render(<TextField id="name" label="Nombre" error="Escribe un nombre." />);
    const input = screen.getByLabelText('Nombre');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Escribe un nombre.');
    expect(document.querySelector('.field-help')).toBeNull();
  });

  it('un campo obligatorio lleva asterisco fuera del nombre accesible y `aria-required`', () => {
    render(<TextField id="name" label="Nombre" aria-required="true" />);
    const input = screen.getByRole('textbox', { name: 'Nombre' });
    expect(input?.getAttribute('aria-required')).toBe('true');
    expect(document.querySelector('.field-required')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('sin error ni obligatoriedad no añade atributos', () => {
    render(<TextField id="note" label="Nota" />);
    const input = screen.getByRole('textbox', { name: 'Nota' });
    expect(input.hasAttribute('aria-required')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(document.querySelector('.field-required')).toBeNull();
  });
});

describe('Segmented', () => {
  it('es un grupo de botones de opción con su leyenda y avisa del cambio', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        legend="Cómo indicar el punto"
        name="mode"
        value="map"
        onChange={onChange}
        options={[
          { value: 'map', label: 'Mapa', icon: 'map' },
          { value: 'coords', label: 'Coordenadas' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Cómo indicar el punto' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Mapa' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Coordenadas' }));
    expect(onChange).toHaveBeenCalledWith('coords');
  });
});
