import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/icon';
import { SORTS, VALIDATED_DAYS, activeFilterCount, type LibraryFilters } from './library-state';

interface Props {
  filters: LibraryFilters;
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  update: (changes: Record<string, string | null>) => void;
  clear: () => void;
}

/** Búsqueda por nombre, filtros y orden (RF-512). Todo cambia la dirección y vuelve a la página 1. */
export function LibraryFilterPanel({ filters, draft, onDraft, onSubmit, update, clear }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(activeFilterCount(filters) > (filters.q ? 1 : 0));
  const active = activeFilterCount(filters);
  const set = (key: string) => (value: string) => update({ [key]: value, page: null });
  const number = (key: string, label: string, value: number | null, step = '1') => (
    <div className="field">
      <label htmlFor={`routes-${key}`}>{label}</label>
      <input id={`routes-${key}`} type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} onChange={(event) => set(key)(event.target.value)} />
    </div>
  );
  return (
    <div className="library-filters">
      <form className="search-bar" role="search" onSubmit={onSubmit}>
        <div className="field search-field">
          <label htmlFor="routes-search" className="visually-hidden">
            {t('routes.searchLabel')}
          </label>
          <div className="field-row">
            <input
              id="routes-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={120}
              placeholder={t('routes.searchLabel')}
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
            />
            <button type="submit" className="button button-secondary button-icon" aria-label={t('routes.searchSubmit')}>
              <Icon name="search" />
            </button>
          </div>
        </div>
      </form>
      <details className="library-filter-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <Icon name="filter" />
          {t('routes.filters.title')}
          {active > 0 ? ` (${active})` : ''}
        </summary>
        <div className="library-filter-grid">
          <div className="field">
            <label htmlFor="routes-status">{t('routes.filters.status')}</label>
            <select id="routes-status" value={filters.status} onChange={(event) => set('status')(event.target.value === 'active' ? '' : event.target.value)}>
              <option value="active">{t('routes.filters.statusActive')}</option>
              <option value="archived">{t('routes.filters.statusArchived')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="routes-version">{t('routes.filters.version')}</label>
            <select id="routes-version" value={filters.versionStatus} onChange={(event) => set('version')(event.target.value)}>
              <option value="">{t('routes.filters.versionAny')}</option>
              <option value="draft">{t('routes.filters.versionDraft')}</option>
              <option value="validated">{t('routes.filters.versionValidated')}</option>
            </select>
          </div>
          {number('minKm', t('routes.filters.minDistance'), filters.minKm, '0.1')}
          {number('maxKm', t('routes.filters.maxDistance'), filters.maxKm, '0.1')}
          {number('minAscent', t('routes.filters.minAscent'), filters.minAscent)}
          {number('maxAscent', t('routes.filters.maxAscent'), filters.maxAscent)}
          <div className="field">
            <label htmlFor="routes-validated">{t('routes.filters.validatedWithin')}</label>
            <select id="routes-validated" value={filters.validatedDays ?? ''} onChange={(event) => set('validated')(event.target.value)}>
              <option value="">{t('routes.filters.validatedAny')}</option>
              {VALIDATED_DAYS.map((days) => (
                <option key={days} value={days}>
                  {t('routes.filters.validatedDays', { days })}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="routes-sort">{t('routes.filters.sort')}</label>
            <select id="routes-sort" value={filters.sort} onChange={(event) => set('sort')(event.target.value === 'updated_desc' ? '' : event.target.value)}>
              {SORTS.map((id) => (
                <option key={id} value={id}>
                  {t(`routes.sort.${id}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {active > 0 && (
          <button type="button" className="button button-secondary" onClick={clear}>
            {t('routes.filters.clear')}
          </button>
        )}
      </details>
    </div>
  );
}
