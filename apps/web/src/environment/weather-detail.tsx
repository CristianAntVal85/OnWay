import { useId } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { clock, dayLabel, decimal } from './format';

type Weather = OperationOutput<'getEnvironment'>['weather'];
type Point = Weather['hourly'][number];

const HOURS_SHOWN = 24;
const HOUR_STEP = 3;

/**
 * Detalle del tiempo (RF-704, issue #18): todo lo que antes enseñaba la tarjeta de Inicio. `ok` = dato fresco; `stale` = último dato guardado con su hora; `unavailable` = sin dato. En los dos últimos
 * casos el resto de la pantalla sigue funcionando. Cita al proveedor como exigen sus condiciones, en texto y sin enlace.
 */
export function WeatherDetail({ weather, locale, onRetry }: { weather: Weather; locale: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { current } = weather;
  const hours = weather.hourly.filter((_, index) => index % HOUR_STEP === 0).slice(0, HOURS_SHOWN / HOUR_STEP);

  return (
    <section className="env-card" aria-labelledby={titleId} data-status={weather.status}>
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
          <h4>{t('environment.weather.now')}</h4>
          <dl className="facts-grid env-now">
            <div>
              <dt>{t('environment.weather.temperature')}</dt>
              <dd>{t('environment.weather.temperatureValue', { value: decimal(current.temperatureC, locale, 1) })}</dd>
            </div>
            <div>
              <dt>{t('environment.weather.wind')}</dt>
              <dd>{windText(current, locale, t, false)}</dd>
            </div>
            <div>
              <dt>{t('environment.weather.precipitation')}</dt>
              <dd>{t('environment.weather.precipitationValue', { value: decimal(current.precipitationMm, locale, 1) })}</dd>
            </div>
            {current.snowfallCm !== null && (
              <div>
                <dt>{t('environment.weather.snowfall')}</dt>
                <dd>{t('environment.weather.snowfallValue', { value: decimal(current.snowfallCm, locale, 1) })}</dd>
              </div>
            )}
            <div>
              <dt>{t('environment.weather.cloud')}</dt>
              <dd>{t('environment.weather.cloudValue', { value: decimal(current.cloudCoverPct, locale) })}</dd>
            </div>
            <div>
              <dt>{t('environment.weather.freezingLevel')}</dt>
              <dd>{current.freezingLevelM === null ? t('environment.weather.noFreezingLevel') : t('environment.weather.freezingValue', { meters: decimal(current.freezingLevelM, locale) })}</dd>
            </div>
          </dl>
        </>
      )}

      {weather.daily.length > 0 && (
        <>
          <h4>{t('environment.weather.nextDays')}</h4>
          <ul className="env-days">
            {weather.daily.map((day) => (
              <li key={day.date}>
                <strong>{dayLabel(day.date, locale)}</strong>
                <span className="env-day-range">{t('environment.weather.dayRange', { min: decimal(day.minC, locale), max: decimal(day.maxC, locale) })}</span>
                <span className="env-day-detail">
                  {t('environment.weather.dayDetail', {
                    gust: day.maxWindGustKmh === null ? '–' : decimal(day.maxWindGustKmh, locale),
                    rain: decimal(day.precipitationMm, locale, 1),
                    snow: day.snowfallCm === null ? '–' : decimal(day.snowfallCm, locale, 1),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {hours.length > 0 && (
        <details className="env-hourly">
          <summary>{t('environment.weather.hourly')}</summary>
          <div className="table-scroll">
            <table>
              <caption>{t('environment.weather.hourlyCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('environment.weather.columns.time')}</th>
                  <th scope="col">{t('environment.weather.columns.temperature')}</th>
                  <th scope="col">{t('environment.weather.columns.wind')}</th>
                  <th scope="col">{t('environment.weather.columns.precipitation')}</th>
                  <th scope="col">{t('environment.weather.columns.cloud')}</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour.time}>
                    <th scope="row">{clock(hour.time, locale)}</th>
                    <td>{t('environment.weather.temperatureValue', { value: decimal(hour.temperatureC, locale) })}</td>
                    <td>{windText(hour, locale, t, true)}</td>
                    <td>{t('environment.weather.precipitationValue', { value: decimal(hour.precipitationMm, locale, 1) })}</td>
                    <td>{t('environment.weather.cloudValue', { value: decimal(hour.cloudCoverPct, locale) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {weather.status !== 'unavailable' && <p className="env-attribution">{t('environment.weather.attribution')}</p>}
    </section>
  );
}

/** Viento con rachas si las hay; `short` = versión compacta para la tabla por hora. */
function windText(point: Point, locale: string, t: TFunction, short: boolean): string {
  const speed = decimal(point.windSpeedKmh, locale);
  if (point.windGustKmh === null) return t('environment.weather.windValue', { speed });
  const gust = decimal(point.windGustKmh, locale);
  return t(short ? 'environment.weather.windShort' : 'environment.weather.windWithGusts', { speed, gust });
}
