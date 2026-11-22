import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { ErrorState, LoadingState } from '../components/states';
import { useApi } from '../session/api-context';
import { formatDateTime } from './format';

type Entry = OperationOutput<'listMissionHistory'>['items'][number];

const PAGE_SIZE = 20;
const FIELD_KEYS = ['name', 'description', 'coordinatorId', 'target', 'note', 'location', 'kind', 'position'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
const isField = (value: string): value is FieldKey => (FIELD_KEYS as readonly string[]).includes(value);

/**
 * Historial de la misión (RN-05, RF-205): quién hizo qué y cuándo, de más reciente a más antiguo (el orden lo pone el servidor).
 * Cada acción se muestra con su texto traducido; nunca el nombre técnico de la acción. Empieza plegado con la última entrada y
 * «Ver más» despliega el historial completo, paginado.
 */
export function MissionHistory({ missionId, locale }: { missionId: string; locale: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const [page, setPage] = useState(1);
  // Plegado, solo la entrada más reciente: el historial completo alargaría la vista sin medida.
  const [expanded, setExpanded] = useState(false);
  const history = useQuery({
    queryKey: ['missions', 'history', missionId, page],
    queryFn: ({ signal }) => api.listMissionHistory({ params: { missionId }, query: { page, pageSize: PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });

  const data = history.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const shown = data ? (expanded ? data.items : data.items.slice(0, 1)) : [];
  const toggle = () => {
    if (expanded) setPage(1);
    setExpanded(!expanded);
  };

  const summaryOf = (entry: Entry): string | null => {
    if (!entry.summary) return null;
    // «Datos editados»: el servidor manda los campos tocados por su nombre; aquí se dicen con palabras.
    if (entry.action !== 'mission_updated') return entry.summary;
    return entry.summary
      .split(', ')
      .map((field) => (isField(field) ? t(`missionDetail.history.fields.${field}`) : field))
      .join(', ');
  };

  return (
    <section className="detail-history" aria-labelledby="history-title">
      <h2 id="history-title">{t('missionDetail.history.title')}</h2>
      {history.isPending && <LoadingState />}
      {history.isError && !data && <ErrorState error={history.error} onRetry={() => void history.refetch()} />}
      {data && data.items.length === 0 && <p className="form-note">{t('missionDetail.history.empty')}</p>}
      {data && data.items.length > 0 && (
        <>
          <ol id="history-list" className="history-list" aria-busy={history.isFetching}>
            {shown.map((entry) => {
              const summary = summaryOf(entry);
              return (
                <li key={entry.id} className="history-item" data-action={entry.action}>
                  <p className="history-action">
                    {t(`missionDetail.history.actions.${entry.action}`)}
                    {summary && <span className="history-summary">: {summary}</span>}
                  </p>
                  <p className="history-meta">
                    <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt, locale)}</time> ·{' '}
                    {t('missionDetail.history.by', { actor: entry.actor?.displayName ?? t('missionDetail.history.system') })}
                  </p>
                </li>
              );
            })}
          </ol>
          {history.isError && <ErrorState error={history.error} onRetry={() => void history.refetch()} />}
          {expanded && pages > 1 && (
            <nav className="pager" aria-label={t('missions.pagination.label')}>
              <button type="button" className="button button-secondary" aria-disabled={page <= 1} onClick={() => page > 1 && setPage(page - 1)}>
                {t('missions.pagination.previous')}
              </button>
              <span>{t('missions.pagination.page', { page, pages })}</span>
              <button type="button" className="button button-secondary" aria-disabled={page >= pages} onClick={() => page < pages && setPage(page + 1)}>
                {t('missions.pagination.next')}
              </button>
            </nav>
          )}
          {data.total > 1 && (
            <button type="button" className="button button-secondary history-toggle" aria-expanded={expanded} aria-controls="history-list" onClick={toggle}>
              {t(expanded ? 'missionDetail.history.showLess' : 'missionDetail.history.showMore')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
