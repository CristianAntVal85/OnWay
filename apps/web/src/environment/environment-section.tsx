import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { ErrorState, LoadingState } from '../components/states';
import { decimal } from './format';
import { useDeviceLocation } from './device-location';
import { LightCard } from './light-card';
import { useEnvironment, type EnvironmentSource } from './use-environment';
import { WeatherCard } from './weather-card';

const SECTION_ID = 'environment';

/** Al elegir una misión desde una lista larga, el tiempo cambia más arriba: se acerca a la vista sin mover el foco. */
export function revealEnvironment(): void {
  document.getElementById(SECTION_ID)?.scrollIntoView?.({ block: 'nearest' });
}

interface Props {
  /** Misión elegida: se muestra su objetivo. Sin ella, la ubicación del dispositivo (RF-704). */
  mission: { id: string; name: string } | null;
  /** Para volver a la ubicación propia. Sin esta función no hay enlace (p. ej. en el detalle de una misión). */
  onBackToDevice?: () => void;
  /** Título de la sección; por defecto «Tiempo, luz y luna». */
  title?: string;
  locale: string;
}

/**
 * Tiempo, luz y luna (RF-704, RF-705, RF-708) de la ubicación del dispositivo o del objetivo de una misión. Sirve igual al inicio del
 * personal, a la cabecera de Mis misiones y al detalle de una misión del rescatista. Una consulta por punto: no se refresca sola.
 * Cada fallo se queda en su tarjeta; el resto de la pantalla sigue funcionando.
 */
export function EnvironmentSection({ mission, onBackToDevice, title, locale }: Props) {
  const { t } = useTranslation();
  const { location, request } = useDeviceLocation();
  const headingId = useId();

  const source: EnvironmentSource | null = mission ? { type: 'mission', missionId: mission.id } : location.status === 'ready' ? { type: 'device', lat: location.lat, lon: location.lon } : null;
  const environment = useEnvironment(source);

  // La región `status` dice, sin mover el foco, de qué punto se está hablando cuando cambia.
  const announcement = mission ? t('environment.announceMission', { name: mission.name }) : source ? t('environment.announceDevice') : '';

  const data = environment.data;
  const basis = mission ? t('environment.basis.mission', { name: mission.name }) : t('environment.basis.device');
  const waitingForLocation = !mission && location.status === 'pending';
  const noLocation = !mission && (location.status === 'denied' || location.status === 'failed' || location.status === 'unsupported');

  return (
    <section id={SECTION_ID} className="env-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title ?? t('environment.title')}</h2>
      <p className="env-basis">
        <strong>{basis}</strong>
        {mission && onBackToDevice && (
          <>
            {' '}
            <button type="button" className="button-link" onClick={onBackToDevice}>
              {t('environment.backToDevice')}
            </button>
          </>
        )}
      </p>
      <div role="status" className="visually-hidden">
        {announcement}
      </div>

      {waitingForLocation && <LoadingState label={t('environment.locating')} />}

      {noLocation && (
        <div className="state state-empty env-nolocation">
          <h3>{t('environment.noLocation.title')}</h3>
          <p>{t(`environment.noLocation.${location.status as 'denied' | 'failed' | 'unsupported'}`)}</p>
          {location.status !== 'unsupported' && (
            <button type="button" className="button button-secondary" onClick={request}>
              {t('environment.noLocation.retry')}
            </button>
          )}
        </div>
      )}

      {source && environment.isPending && <LoadingState />}
      {source && environment.isError && (
        <ErrorState
          error={environment.error}
          {...(environment.error instanceof ApiError && (environment.error.code === 'OUTSIDE_COVERAGE' || environment.error.code === 'NOT_FOUND') ? {} : { onRetry: () => void environment.refetch() })}
        />
      )}

      {data && (
        <>
          <p className="env-place">{t('environment.place', { position: formatCoordinate(data.location, 'decimal'), meters: decimal(data.location.elevationM, locale) })}</p>
          <p className="field-help">{t('environment.altitudeNote')}</p>
          <div className="env-cards" aria-busy={environment.isFetching}>
            <WeatherCard weather={data.weather} locale={locale} onRetry={() => void environment.refetch()} />
            <LightCard sun={data.sun} moon={data.moon} locale={locale} />
          </div>
        </>
      )}
    </section>
  );
}
