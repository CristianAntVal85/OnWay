import type { OperationOutput } from '@onway/contracts/client';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDate, formatMeters } from '../missions/format';
import { routePath } from '../nav/navigation';
import { formatKm } from './format';

export type RouteItem = OperationOutput<'listRoutes'>['items'][number];

/** Cómo se pinta la ruta en el mapa y en su tarjeta: por la última versión (una validada antigua se señala aparte). */
export function toneOf(item: RouteItem): 'draft' | 'validated' | 'stale' | 'archived' {
  if (item.status === 'archived') return 'archived';
  if (item.latestVersion.status === 'draft') return 'draft';
  return item.latestValidated?.isStale ? 'stale' : 'validated';
}

interface Props {
  item: RouteItem;
  selected: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onHighlight: (highlighted: boolean) => void;
  cardRef?: (element: HTMLLIElement | null) => void;
}

export function RouteCard({ item, selected, highlighted, onToggle, onHighlight, cardRef }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const { latestVersion: latest, latestValidated: validated } = item;
  const tone = toneOf(item);
  return (
    <li
      className="route-card"
      ref={cardRef}
      data-id={item.id}
      data-tone={tone}
      data-highlighted={highlighted || undefined}
      data-selected={selected || undefined}
      onMouseEnter={() => onHighlight(true)}
      onMouseLeave={() => onHighlight(false)}
      onFocus={() => onHighlight(true)}
      onBlur={() => onHighlight(false)}
    >
      <div className="route-card-head">
        <label className="route-card-select">
          <input type="checkbox" className="route-card-check" checked={selected} onChange={onToggle} aria-label={t('routes.card.select', { name: item.name })} />
        </label>
        <h2>
          <Link to={routePath(item.id)}>{item.name}</Link>
        </h2>
      </div>
      <p className="route-badges route-card-badges">
        <span className="status-badge" data-version={latest.status}>
          {t(`routes.card.${latest.status}`)} · {t('routes.card.version', { number: latest.number })}
        </span>
        {item.status === 'archived' && (
          <span className="status-badge" data-archived="true">
            {t('routes.card.archived')}
          </span>
        )}
        {validated?.isStale && (
          <span className="status-badge" data-stale="true" title={t('routes.card.staleHint')}>
            {t('routes.card.stale')}
          </span>
        )}
        {item.derivedFromRouteId && <span className="status-badge">{t('routes.card.copy')}</span>}
      </p>
      <dl className="route-figures">
        <div>
          <dt className="visually-hidden">{t('routes.card.distance')}</dt>
          <dd>{t('units.km', { value: formatKm(latest.metrics.distanceM, locale) })}</dd>
        </div>
        <div>
          <dt>{t('routes.card.ascent')}</dt>
          <dd>{t('units.m', { value: formatMeters(latest.metrics.ascentM, locale) })}</dd>
        </div>
        <div>
          <dt>{t('routes.card.maxElevation')}</dt>
          <dd>{t('units.m', { value: formatMeters(latest.metrics.maxElevationM, locale) })}</dd>
        </div>
      </dl>
      <p className="route-card-meta">
        {item.usedInMissions > 0 ? t('routes.card.usedInValue', { count: item.usedInMissions }) : t('routes.card.notUsed')}
        {' · '}
        {validated ? t('routes.card.validatedOn', { date: formatDate(validated.validatedAt, locale), number: validated.number }) : t('routes.card.neverValidated')}
      </p>
    </li>
  );
}
