// Iconos del tiempo (issue #18, D-W6): SVG propios en línea, decorativos y sin colores literales (los pone la hoja con tokens).
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WeatherIcon, WEATHER_ICON_NAMES, symbolIcon } from '../src/environment/weather-icons';

describe('WeatherIcon', () => {
  it.each(WEATHER_ICON_NAMES)('«%s» es un SVG decorativo, sin foco y sin colores literales', (name) => {
    const { container } = render(<WeatherIcon name={name} />);
    const svg = container.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(svg.classList.contains('wx-icon')).toBe(true);
    expect(svg.querySelectorAll('title, desc')).toHaveLength(0);
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(svg.querySelectorAll('[class^="wx-"]').length).toBeGreaterThan(0);
  });

  it('cada icono pinta solo con las clases de color de la hoja (`wx-sun`, `wx-cloud`…) y la de trazo', () => {
    const { container } = render(<WeatherIcon name="rain" />);
    const classes = new Set([...container.querySelectorAll('[class]')].flatMap((element) => [...element.classList]).filter((name) => name !== 'wx-icon'));
    for (const name of classes) expect(name).toMatch(/^wx-(sun|moon|cloud|rain|snow|wind|heat|stroke)$/);
  });
});

describe('symbolIcon', () => {
  it('lleva cada símbolo al icono de su nombre, con la luna de noche solo donde la hay', () => {
    expect(symbolIcon({ name: 'clear', night: false })).toBe('clear');
    expect(symbolIcon({ name: 'clear', night: true })).toBe('clear-night');
    expect(symbolIcon({ name: 'partly', night: false })).toBe('partly');
    expect(symbolIcon({ name: 'partly', night: true })).toBe('partly-night');
    expect(symbolIcon({ name: 'cloudy', night: false })).toBe('cloudy');
    expect(symbolIcon({ name: 'rain', night: false })).toBe('rain');
    expect(symbolIcon({ name: 'heavy-rain', night: false })).toBe('heavy-rain');
    expect(symbolIcon({ name: 'snow', night: false })).toBe('snow');
  });

  it('todos los iconos que devuelve existen', () => {
    for (const name of ['clear', 'partly', 'cloudy', 'rain', 'heavy-rain', 'snow'] as const) {
      for (const night of [false, true]) expect(WEATHER_ICON_NAMES).toContain(symbolIcon({ name, night }));
    }
  });
});
