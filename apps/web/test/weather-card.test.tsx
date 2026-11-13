// Tarjeta del tiempo simple (issue #18, RF-704): tres iconos por tramo del día con su horario, la temperatura actual y el viento; lo demás va a
// la vista de detalle. El reloj de quien mira se inyecta (UTC aquí) para que la prueba no dependa de la zona de la máquina.
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { createI18n } from '../src/i18n';
import type { ClockTime } from '@onway/geo';
import { WeatherCard } from '../src/environment/weather-card';
import { environment, unavailableWeather } from './environment-support';

const E = es.environment;
const utc = (iso: string): ClockTime => ({ date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)), minute: Number(iso.slice(14, 16)) });
const NOW = new Date('2026-11-01T08:10:00Z');

type Hour = { cloudCoverPct: number; precipitationMm: number; snowfallCm: number | null; temperatureC: number };
/** Horas de reloj UTC desde las 08:00 del 1 de noviembre; `make` decide cada una. */
function weather(make: (hourOfDay: number, day: number) => Partial<Hour> = () => ({}), overrides: Record<string, unknown> = {}) {
  const base = environment().weather;
  const hourly = Array.from({ length: 48 }, (_, index) => {
    const time = new Date(Date.UTC(2026, 10, 1, 8 + index)).toISOString();
    const hourOfDay = (8 + index) % 24;
    return { ...base.hourly[0]!, time, cloudCoverPct: 5, precipitationMm: 0, snowfallCm: 0, temperatureC: 6, ...make(hourOfDay, Math.floor((8 + index) / 24)) };
  });
  return { ...base, hourly, ...overrides } as unknown as Weather;
}
type Weather = OperationOutput<'getEnvironment'>['weather'];
const sun = environment().sun;

function renderCard(data: Weather, options: { now?: Date; language?: 'es' | 'fr'; missionId?: string | null } = {}) {
  const language = options.language ?? 'es';
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <MemoryRouter>
        <WeatherCard weather={data} sun={sun} locale={language} now={options.now ?? NOW} clock={utc} missionId={options.missionId ?? null} onRetry={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}
const parts = () => screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'));

describe('tarjeta del tiempo simple', () => {
  it('por la mañana salen Mañana, Tarde y Noche, cada una con su horario y su símbolo', () => {
    renderCard(weather((hour) => (hour >= 12 && hour < 18 ? { precipitationMm: 0.5, cloudCoverPct: 90 } : {})));
    expect(parts()).toEqual(['Mañana, 06–12 h: Despejado', 'Tarde, 12–18 h: Lluvia', 'Noche, 18–24 h: Despejado']);
    const list = screen.getByRole('list', { name: E.simple.partsLabel });
    expect(within(list).getByText('06–12 h')).toBeTruthy();
    expect(within(list).getByText('12–18 h')).toBeTruthy();
    expect(within(list).getByText('18–24 h')).toBeTruthy();
  });

  it('si ya estamos en la tarde empieza por la Tarde y la Mañana (la de mañana) va al final con su horario', () => {
    renderCard(weather(), { now: new Date('2026-11-01T13:20:00Z') });
    expect(parts().map((label) => label!.split(',')[0])).toEqual(['Tarde', 'Noche', 'Mañana']);
    expect(parts()[2]).toContain('06–12 h');
  });

  it('cada símbolo sale de las horas de su tramo: lluvia, lluvia fuerte, nieve, nubes y luna de noche', () => {
    renderCard(
      weather((hour) => {
        if (hour >= 8 && hour < 12) return { precipitationMm: 12, cloudCoverPct: 100 };
        if (hour >= 12 && hour < 18) return { snowfallCm: 2, cloudCoverPct: 100, temperatureC: -2 };
        return { cloudCoverPct: 40 };
      }),
    );
    expect(parts()).toEqual(['Mañana, 06–12 h: Lluvia fuerte', 'Tarde, 12–18 h: Nieve', 'Noche, 18–24 h: Poco nuboso']);
  });

  it('el icono de cada tramo es un SVG decorativo con el color de su símbolo', () => {
    const { container } = renderCard(weather());
    const icons = container.querySelectorAll('.wx-part svg.wx-icon');
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('enseña el termómetro con la temperatura actual y el viento con km/h, y nada más del tiempo', () => {
    renderCard(weather());
    const card = screen.getByRole('region', { name: E.weather.title });
    expect(within(card).getByText('2 °C')).toBeTruthy();
    expect(within(card).getByText('17 km/h')).toBeTruthy();
    expect(within(card).getByText(E.simple.temperatureNow)).toBeTruthy();
    expect(within(card).getByText(E.simple.windNow)).toBeTruthy();
    for (const hidden of [E.weather.precipitation, E.weather.snowfall, E.weather.cloud, E.weather.freezingLevel, E.weather.nextDays, E.weather.hourly, E.weather.now]) {
      expect(within(card).queryByText(hidden)).toBeNull();
    }
    expect(within(card).queryByText(/rachas/i)).toBeNull();
    expect(within(card).queryByText(/2\.?890/)).toBeNull();
    expect(within(card).queryByRole('table')).toBeNull();
    expect(card.querySelector('details')).toBeNull();
  });

  it('el botón lleva a la vista de detalle, con la misión si se mira una', () => {
    const { unmount } = renderCard(weather());
    expect(screen.getByRole('link', { name: E.simple.detailCta }).getAttribute('href')).toBe('/weather');
    unmount();
    renderCard(weather(), { missionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(screen.getByRole('link', { name: E.simple.detailCta }).getAttribute('href')).toBe('/weather?mission=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('un tramo sin horas previstas dice «Sin datos» en lugar de inventar un símbolo', () => {
    const short = weather(() => ({}), {});
    short.hourly = short.hourly.slice(0, 2); // solo 08 y 09 h
    renderCard(short);
    expect(parts()).toEqual(['Mañana, 06–12 h: Despejado', `Tarde, 12–18 h: ${E.simple.symbols.none}`, `Noche, 18–24 h: ${E.simple.symbols.none}`]);
  });

  it('con el dato guardado avisa con su hora y conserva la cita al proveedor; sin dato avisa, ofrece reintentar y no lleva al detalle', () => {
    const { unmount } = renderCard(weather(() => ({}), { status: 'stale', fetchedAt: '2026-11-01T07:05:00.000Z' }));
    const card = screen.getByRole('region', { name: E.weather.title });
    expect(within(card).getByRole('status').textContent).toMatch(/^Último dato guardado a las \d{2}:\d{2}: no se ha podido actualizar\.$/);
    expect(within(card).getByText(E.weather.attribution)).toBeTruthy();
    expect(within(card).getByRole('link', { name: E.simple.detailCta })).toBeTruthy();
    unmount();

    const retry = vi.fn();
    render(
      <I18nextProvider i18n={createI18n('es')}>
        <MemoryRouter>
          <WeatherCard weather={unavailableWeather as never} sun={sun} locale="es" now={NOW} clock={utc} missionId={null} onRetry={retry} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    const unavailable = screen.getByRole('region', { name: E.weather.title });
    expect(within(unavailable).getByText(E.weather.unavailable)).toBeTruthy();
    expect(within(unavailable).getByRole('button', { name: E.weather.retry })).toBeTruthy();
    expect(within(unavailable).queryByRole('link', { name: E.simple.detailCta })).toBeNull();
    expect(within(unavailable).queryByRole('list')).toBeNull();
    expect(within(unavailable).queryByText(E.weather.attribution)).toBeNull();
  });

  it('en francés los tramos, el horario, los símbolos y el botón se leen en francés', () => {
    renderCard(
      weather((hour) => (hour >= 12 && hour < 18 ? { precipitationMm: 0.5, cloudCoverPct: 90 } : {})),
      { language: 'fr' },
    );
    expect(parts()).toEqual(['Matin, 06–12 h : Dégagé', 'Après-midi, 12–18 h : Pluie', 'Soir, 18–24 h : Dégagé']);
    expect(screen.getByRole('link', { name: fr.environment.simple.detailCta })).toBeTruthy();
  });
});
