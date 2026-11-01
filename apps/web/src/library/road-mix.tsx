import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';

type Mix = OperationOutput<'getRoute'>['versions'][number]['roadMix'];

const ORDER = ['road', 'track', 'path', 'offtrail', 'unknown'] as const;

/**
 * La composición de una ruta por tipo de vía (RF-503): una barra y, debajo, el mismo dato en texto con porcentajes (el color no es lo único
 * que lo dice). «Sin clasificar» es lo que no pasó por el motor de rutas (importada, dibujada o editada a mano).
 */
export function RoadMix({ mix }: { mix: Mix }) {
  const { t } = useTranslation();
  const total = mix.reduce((sum, part) => sum + part.distanceM, 0);
  if (!(total > 0)) return <span className="road-mix-none">{t('roadMix.none')}</span>;
  const parts = ORDER.map((type) => ({ type, share: mix.filter((part) => part.roadType === type).reduce((sum, part) => sum + part.distanceM, 0) / total })).filter((part) => part.share > 0);
  const text = parts.map((part) => t('roadMix.part', { type: t(`routeDetail.metrics.roadTypes.${part.type}`), percent: Math.round(part.share * 100) })).join(' · ');
  return (
    <span className="road-mix" role="img" aria-label={t('roadMix.summary', { parts: text })}>
      <span className="road-mix-bar" aria-hidden="true">
        {parts.map((part) => (
          <span key={part.type} className={`road-mix-part road-mix-${part.type}`} style={{ width: `${part.share * 100}%` }} />
        ))}
      </span>
      <span className="road-mix-text" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
