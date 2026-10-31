import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatKm } from './format';
import { profileShape, tableRows } from './profile-path';

const BOX = { width: 640, height: 220, left: 52, right: 12, top: 12, bottom: 30 };

/**
 * Perfil de elevación en SVG propio (D-H2-13). Es una imagen con título y descripción para lectores de pantalla y, además,
 * una tabla con los mismos datos (con menos filas) a la que se llega con el teclado.
 */
export function ElevationProfile({ profile, versionNumber, locale }: { profile: readonly (readonly [number, number])[]; versionNumber: number; locale: string }) {
  const { t } = useTranslation();
  const id = useId();
  const shape = profileShape(profile, BOX);
  const km = (meters: number) => formatKm(meters, locale);
  const m = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  return (
    <figure className="profile">
      <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`} className="profile-svg">
        <title id={`${id}-title`}>{t('routeDetail.profile.title')}</title>
        <desc id={`${id}-desc`}>{t('routeDetail.profile.description', { number: versionNumber, min: m(shape.minElevation), max: m(shape.maxElevation), distance: km(shape.totalMeters) })}</desc>
        {shape.yTicks.map((tick) => (
          <g key={tick.value} className="profile-grid">
            <line x1={BOX.left} x2={BOX.width - BOX.right} y1={tick.y} y2={tick.y} />
            <text x={BOX.left - 6} y={tick.y + 4} textAnchor="end">
              {m(tick.value)}
            </text>
          </g>
        ))}
        {shape.xTicks.map((tick) => (
          <text key={tick.value} className="profile-axis" x={tick.x} y={BOX.height - 8} textAnchor="middle">
            {km(tick.value)}
          </text>
        ))}
        <polygon className="profile-area" points={shape.area} />
        <polyline className="profile-line" points={shape.line} fill="none" />
      </svg>
      <details className="profile-table">
        <summary>{t('routeDetail.profile.showTable')}</summary>
        <table>
          <caption>{t('routeDetail.profile.tableCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('routeDetail.profile.columnDistance')}</th>
              <th scope="col">{t('routeDetail.profile.columnElevation')}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows(profile).map(([distance, elevation]) => (
              <tr key={distance}>
                <td>{km(distance)}</td>
                <td>{m(elevation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
