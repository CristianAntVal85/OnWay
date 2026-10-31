import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { formatDate } from '../missions/format';
import { StatusBadge } from '../missions/status-badge';
import { PATHS, missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';
import { LaterPage } from './later-page';

type Tab = 'planning' | 'active' | 'closed';
type Item = OperationOutput<'listMissions'>['items'][number];

const TABS: readonly Tab[] = ['planning', 'active', 'closed'];
const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

/** Número de página de la dirección; cualquier cosa que no sea un entero positivo es la página 1. */
const pageNumber = (raw: string | null) => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
};

const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);

/**
 * Misiones (boceto 4, RF-204): pestañas por estado y búsqueda por nombre. La pestaña, la búsqueda y la página viven en la dirección,
 * así «atrás» y los enlaces funcionan. El rescatista tiene su propia lista (Mis misiones, T9): aquí no tiene `listMissions`.
 */
export function MissionsPage() {
  const user = useCurrentUser();
  if (user.role === 'rescuer') return <LaterPage section="nav.missions" />;
  return <StaffMissions canCreate={user.role === 'coordinator'} />;
}

function StaffMissions({ canCreate }: { canCreate: boolean }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const locale = i18n.resolvedLanguage ?? 'es';
  const [params, setParams] = useSearchParams();
  usePageTitle(t('missions.title'));

  const rawTab = params.get('tab');
  const tab: Tab = isTab(rawTab) ? rawTab : 'planning';
  const q = params.get('q') ?? '';
  const page = pageNumber(params.get('page'));

  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  // La búsqueda se aplica al dejar de teclear (o al pulsar Buscar); cambiarla vuelve a la página 1.
  useEffect(() => {
    const text = draft.trim();
    if (text === q) return;
    const timer = setTimeout(() => update({ q: text, page: null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // `update` cambia en cada render; solo importa lo que se ha escrito.
  }, [draft, q]);

  const missions = useQuery({
    queryKey: ['missions', 'list', { tab, q, page }],
    queryFn: ({ signal }) => api.listMissions({ query: { status: tab, ...(q ? { q } : {}), page, pageSize: PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: draft.trim(), page: null });
  };

  const tabLabel = (id: Tab) => t(`missions.tabs.${id}`);
  const data = missions.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const createLink = canCreate ? (
    <Link className="button button-primary" to={PATHS.createMission}>
      {t('missions.createCta')}
    </Link>
  ) : undefined;

  return (
    <>
      <div className="page-heading">
        <h1>{t('missions.title')}</h1>
        {createLink}
      </div>

      <div className="tabs" role="tablist" aria-label={t('missions.tabsLabel')}>
        {TABS.map((id) => (
          <button
            key={id}
            id={`missions-tab-${id}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === id}
            aria-controls="missions-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => update({ tab: id, page: null })}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              event.preventDefault();
              const next = TABS[(TABS.indexOf(id) + step + TABS.length) % TABS.length]!;
              update({ tab: next, page: null });
              document.getElementById(`missions-tab-${next}`)?.focus();
            }}
          >
            {tabLabel(id)}
          </button>
        ))}
      </div>

      <div id="missions-panel" role="tabpanel" aria-labelledby={`missions-tab-${tab}`}>
        <form className="search-bar" role="search" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="missions-search">{t('missions.searchLabel')}</label>
            <div className="field-row">
              <input id="missions-search" type="search" autoComplete="off" spellCheck={false} maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="button button-secondary">
                {t('missions.searchSubmit')}
              </button>
            </div>
          </div>
        </form>

        {missions.isPending && <LoadingState />}
        {missions.isError && <ErrorState error={missions.error} onRetry={() => void missions.refetch()} />}
        {data && data.items.length === 0 && (
          <EmptyState
            action={
              q ? (
                <button type="button" className="button button-secondary" onClick={() => update({ q: null, page: null })}>
                  {t('missions.clearSearch')}
                </button>
              ) : (
                createLink
              )
            }
          >
            {q ? t('missions.emptySearch', { query: q }) : t(`missions.empty.${tab}`)}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <>
            <p className="result-count" role="status">
              {t('missions.summary', { total: data.total })}
            </p>
            <ul className="mission-list" aria-busy={missions.isFetching}>
              {data.items.map((item) => (
                <MissionCard key={item.id} item={item} locale={locale} />
              ))}
            </ul>
            {pages > 1 && (
              <nav className="pager" aria-label={t('missions.pagination.label')}>
                <button type="button" className="button button-secondary" aria-disabled={page <= 1} onClick={() => page > 1 && update({ page: String(page - 1) })}>
                  {t('missions.pagination.previous')}
                </button>
                <span>{t('missions.pagination.page', { page, pages })}</span>
                <button type="button" className="button button-secondary" aria-disabled={page >= pages} onClick={() => page < pages && update({ page: String(page + 1) })}>
                  {t('missions.pagination.next')}
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}

function MissionCard({ item, locale }: { item: Item; locale: string }) {
  const { t } = useTranslation();
  const objective = item.target.label ?? formatCoordinate(item.target, 'decimal');
  return (
    <li className="mission-card">
      <h2>
        <Link to={missionPath(item.id)}>{item.name}</Link>
      </h2>
      <StatusBadge status={item.status} />
      <dl className="facts-grid">
        <div>
          <dt>{t('missions.fields.coordinator')}</dt>
          <dd>{item.coordinator?.displayName ?? t('missions.fields.noCoordinator')}</dd>
        </div>
        <div>
          <dt>{t('missions.fields.objective')}</dt>
          <dd>{objective}</dd>
        </div>
        <div>
          <dt>{t('missions.fields.origins')}</dt>
          <dd>{item.origins.length > 0 ? item.origins.map((origin) => origin.name).join(', ') : t('missions.fields.noOrigins')}</dd>
        </div>
        <div>
          <dt>{t('missions.fields.routes')}</dt>
          <dd>{t('missions.routesValue', { validated: item.routes.validated, total: item.routes.total })}</dd>
        </div>
        <div>
          <dt>{t('missions.fields.participants')}</dt>
          <dd>{t('missions.participantsValue', { accepted: item.participants.accepted, pending: item.participants.pending })}</dd>
        </div>
        <div>
          <dt>{t('missions.fields.created')}</dt>
          <dd>{formatDate(item.createdAt, locale)}</dd>
        </div>
      </dl>
    </li>
  );
}
