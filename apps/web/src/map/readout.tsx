import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCoordinate, type CoordinateFormat } from '@onway/geo';
import type { ElevationLookup, MapPoint } from './types.js';

/** Posición que se está mirando. `immediate` = un toque o clic: la altitud se pide al momento y no tras esperar. */
export interface Cursor extends MapPoint {
  immediate: boolean;
}

const FORMATS: readonly CoordinateFormat[] = ['decimal', 'dms', 'utm'];
const WAIT_MS = 300;

type Elevation = { status: 'idle' } | { status: 'loading' } | { status: 'none' } | { status: 'ok'; meters: number };

/**
 * Indicador de coordenadas y altitud (RF-302, D-H1-09). Las coordenadas se pintan al momento; la altitud se pide cuando el
 * cursor se detiene (~300 ms) o al tocar. Sin `lookup` (el rescatista no tiene `getElevation`) solo hay coordenadas.
 */
export function Readout({ cursor, lookup }: { cursor: Cursor | null; lookup?: ElevationLookup }) {
  const { t, i18n } = useTranslation();
  const [format, setFormat] = useState<CoordinateFormat>('decimal');
  const [elevation, setElevation] = useState<Elevation>({ status: 'idle' });
  const selectId = useId();

  const lat = cursor?.lat;
  const lon = cursor?.lon;
  const immediate = cursor?.immediate ?? false;
  useEffect(() => {
    if (lookup === undefined || lat === undefined || lon === undefined) {
      setElevation({ status: 'idle' });
      return undefined;
    }
    setElevation({ status: 'loading' });
    let cancelled = false;
    const timer = setTimeout(
      () => {
        lookup({ lat, lon }).then(
          (meters) => {
            if (!cancelled) setElevation(meters === null ? { status: 'none' } : { status: 'ok', meters });
          },
          () => {
            if (!cancelled) setElevation({ status: 'none' });
          },
        );
      },
      immediate ? 0 : WAIT_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lat, lon, immediate, lookup]);

  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? 'es', { maximumFractionDigits: 0 });
  return (
    <div className="map-readout">
      <p className="map-readout-position">
        {cursor ? (
          <>
            <span className="map-readout-coordinates">{formatCoordinate(cursor, format)}</span>
            {lookup && (
              <span className="map-readout-elevation">
                {elevation.status === 'ok' && t('map.cursor.elevation', { meters: number.format(elevation.meters) })}
                {elevation.status === 'loading' && t('map.cursor.elevationLoading')}
                {elevation.status === 'none' && t('map.cursor.elevationNone')}
              </span>
            )}
          </>
        ) : (
          <span className="map-readout-hint">{lookup ? t('map.cursor.hint') : t('map.cursor.hintNoElevation')}</span>
        )}
      </p>
      <label className="map-readout-format" htmlFor={selectId}>
        <span className="visually-hidden">{t('map.cursor.format')}</span>
        <select id={selectId} value={format} onChange={(event) => setFormat(event.target.value as CoordinateFormat)}>
          {FORMATS.map((option) => (
            <option key={option} value={option}>
              {t(`map.cursor.${option}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
