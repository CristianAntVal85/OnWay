import { SectionCard } from '../components/section-card';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { METRIC_KEYS, difference, type MetricKey } from './compare';
import { formatKm } from './format';

type Version = OperationOutput<'getRoute'>['versions'][number];
type Detail = OperationOutput<'getRouteVersion'>;

const LABEL: Record<MetricKey, string> = {
  distanceM: 'routeDetail.metrics.distance',
  ascentM: 'routeDetail.metrics.ascent',
  descentM: 'routeDetail.metrics.descent',
  minElevationM: 'routeDetail.metrics.minElevation',
  maxElevationM: 'routeDetail.metrics.maxElevation',
  maxSlopePct: 'routeDetail.metrics.maxSlope',
};

interface Props {
  versions: readonly Version[];
  a: string;
  b: string;
  onChange: (changes: { a?: string; b?: string }) => void;
  onStop: () => void;
  detailA: Detail | undefined;
  detailB: Detail | undefined;
}

/** Dos versiones de la misma ruta, lado a lado: mapa en dos colores (lo pinta la página) y tabla de métricas con la diferencia. */
export function ComparePanel({ versions, a, b, onChange, onStop, detailA, detailB }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const show = (key: MetricKey, value: number) =>
    key === 'distanceM'
      ? t('units.km', { value: formatKm(value, locale) })
      : key === 'maxSlopePct'
        ? t('routeDetail.metrics.slopeValue', { value: number(value) })
        : t('units.m', { value: number(value) });
  const signed = (key: MetricKey, value: number) => {
    if (value === 0) return t('routeDetail.compare.same');
    const sign = value > 0 ? '+' : '−';
    const abs = Math.abs(value);
    // Una diferencia de distancia de menos de un kilómetro se da en metros: en km con un decimal saldría «−0,0 km».
    if (key === 'distanceM') return `${sign}${abs < 1000 ? t('units.m', { value: number(abs) }) : t('units.km', { value: formatKm(abs, locale) })}`;
    return `${sign}${key === 'maxSlopePct' ? t('routeDetail.metrics.slopeValue', { value: number(abs) }) : t('units.m', { value: number(abs) })}`;
  };
  const option = (version: Version) => (
    <option key={version.id} value={version.id}>
      {t('routeDetail.compare.versionOption', { number: version.number, status: t(`routeDetail.versions.${version.status}`) })}
    </option>
  );
  return (
    <SectionCard
      className="compare-panel"
      icon="layers"
      title={t('routeDetail.compare.title')}
      actions={
        <button type="button" className="button button-secondary" onClick={onStop}>
          {t('routeDetail.compare.stop')}
        </button>
      }
    >
      <div className="compare-selects">
        <div className="field">
          <label htmlFor="compare-a">{t('routeDetail.compare.a')}</label>
          <select id="compare-a" value={a} onChange={(event) => onChange({ a: event.target.value })}>
            {versions.map(option)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="compare-b">{t('routeDetail.compare.b')}</label>
          <select id="compare-b" value={b} onChange={(event) => onChange({ b: event.target.value })}>
            {versions.map(option)}
          </select>
        </div>
      </div>
      {detailA && detailB && (
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">{t('routeDetail.compare.metric')}</th>
                <th scope="col">{t('routeDetail.compare.legendA')}</th>
                <th scope="col">{t('routeDetail.compare.legendB')}</th>
                <th scope="col">{t('routeDetail.compare.difference')}</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_KEYS.map((key) => (
                <tr key={key}>
                  <th scope="row">{t(LABEL[key])}</th>
                  <td>{show(key, detailA.metrics[key])}</td>
                  <td>{show(key, detailB.metrics[key])}</td>
                  <td>{signed(key, difference(detailA.metrics, detailB.metrics, key))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
