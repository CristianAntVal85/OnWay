import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { dayPartSymbols, type ClockTime, type DayPartSymbol } from '@onway/geo';
import { weatherPath } from '../nav/navigation';
import { clock, clockTime, decimal } from './format';
import { WeatherIcon, symbolIcon } from './weather-icons';

type Environment = OperationOutput<'getEnvironment'>;

interface Props {
  weather: Environment['weather'];
  /** El sol del mismo punto: dice qué horas del tramo son de noche. */
  sun: Environment['sun'];
  locale: string;
  /** Misión elegida, para que el botón del detalle mire el mismo punto. */
  missionId: string | null;
  onRetry: () => void;
  /** Se inyectan para las pruebas: la hora actual y el reloj de quien mira (por defecto, el del navegador). */
  now?: Date;
  clock?: (iso: string) => ClockTime;
}

/**
 * Tarjeta del tiempo simple (RF-704, issue #18): tres iconos por tramo del día (Mañana, Tarde y Noche, el tramo en curso primero y cada
 * uno con su horario), el termómetro con la temperatura actual y el viento. Todo lo demás está en la vista de detalle. Cada símbolo lo
 * deriva `@onway/geo` de las horas previstas (regla 9); aquí solo se dibuja. `stale` = último dato guardado con su hora; `unavailable` =
 * sin dato (el resto de la pantalla sigue funcionando). Cita al proveedor como exigen sus condiciones, en texto y sin enlace.
 */
export function WeatherCard({ weather, sun, locale, missionId, onRetry, now, clock: clockOf = clockTime }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const { current } = weather;
  const parts = current ? dayPartSymbols(weather.hourly, now ?? new Date(), clockOf, sun) : [];

  return (
    <section className="env-card wx-card" aria-labelledby={titleId} data-status={weather.status}>
      <h3 id={titleId}>{t('environment.weather.title')}</h3>

      {weather.status === 'stale' && weather.fetchedAt && (
        <p className="notice" role="status">
          {t('environment.weather.stale', { time: clock(weather.fetchedAt, locale) })}
        </p>
      )}
      {weather.status === 'unavailable' && (
        <div className="env-unavailable" role="status">
          <p>{t('environment.weather.unavailable')}</p>
          <button type="button" className="button button-secondary" onClick={onRetry}>
            {t('environment.weather.retry')}
          </button>
        </div>
      )}

      {current && (
        <>
          <ul className="wx-parts" aria-label={t('environment.simple.partsLabel')}>
            {parts.map((part) => (
              <DayPart key={part.part} part={part} />
            ))}
          </ul>
          <dl className="wx-now">
            <div>
              <dt className="visually-hidden">{t('environment.simple.temperatureNow')}</dt>
              <dd>
                <WeatherIcon name="thermometer" />
                <strong>{t('environment.weather.temperatureValue', { value: decimal(current.temperatureC, locale, 1) })}</strong>
              </dd>
            </div>
            <div>
              <dt className="visually-hidden">{t('environment.simple.windNow')}</dt>
              <dd>
                <WeatherIcon name="wind" />
                <strong>{t('environment.weather.windValue', { speed: decimal(current.windSpeedKmh, locale) })}</strong>
              </dd>
            </div>
          </dl>
          <Link className="button button-secondary wx-detail-link" to={weatherPath(missionId)}>
            {t('environment.simple.detailCta')}
          </Link>
        </>
      )}

      {weather.status !== 'unavailable' && <p className="env-attribution">{t('environment.weather.attribution')}</p>}
    </section>
  );
}

const SYMBOL_TEXT = { clear: 'clear', partly: 'partly', cloudy: 'cloudy', rain: 'rain', 'heavy-rain': 'heavyRain', snow: 'snow' } as const;

/** Un tramo: icono, nombre y horario en pequeño. Su nombre accesible dice también el símbolo, porque el icono es decorativo. */
function DayPart({ part }: { part: DayPartSymbol }) {
  const { t } = useTranslation();
  const range = t('environment.simple.range', { start: String(part.startHour).padStart(2, '0'), end: String(part.endHour).padStart(2, '0') });
  const text = part.symbol ? t(`environment.simple.symbols.${SYMBOL_TEXT[part.symbol.name]}`) : t('environment.simple.symbols.none');
  const name = t(`environment.simple.parts.${part.part}`);
  return (
    <li className="wx-part" data-symbol={part.symbol?.name ?? 'none'} aria-label={t('environment.simple.partLabel', { part: name, range, symbol: text })}>
      {part.symbol ? <WeatherIcon name={symbolIcon(part.symbol)} /> : <span className="wx-empty" aria-hidden="true" />}
      <span className="wx-part-name" aria-hidden="true">
        {name}
      </span>
      <span className="wx-part-range" aria-hidden="true">
        {range}
      </span>
      <span className="wx-part-text" aria-hidden="true">
        {text}
      </span>
    </li>
  );
}
