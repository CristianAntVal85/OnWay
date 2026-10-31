import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { formatDate } from '../missions/format';
import { MissionSearch, MissionTabs, Pager, useListState } from '../missions/list-controls';
import { StatusBadge } from '../missions/status-badge';
import { PATHS, missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';
import { MyMissionsPage } from './my-missions-page';

type Tab = 'planning' | 'active' | 'closed';
type Item = OperationOutput<'listMissions'>['items'][number];

const TABS: readonly Tab[] = ['planning', 'active', 'closed'];
export const PAGE_SIZE = 20;

/**
 * Misiones (boceto 4, RF-204): pestañas por estado y búsqueda por nombre. La pestaña, la búsqueda y la página viven en la dirección,
 * así «atrás» y los enlaces funcionan. El rescatista tiene su propia lista (Mis misiones, RF-601): aquí no tiene `listMissions`.
 */
export function MissionsPage() {
  const user = useCurrentUser();
  if (user.role === 'rescuer') return <MyMissionsPage />;
  return <StaffMissions canCreate={user.role === 'coordinator'} />;
}

function StaffMissions({ canCreate }: { canCreate: boolean }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const locale = i18n.resolvedLanguage ?? 'es';
  usePageTitle(t('missions.title'));
  const { tab, q, page, draft, setDraft, update, submit } = useListState(TABS, 'planning');

  const missions = useQuery({
    queryKey: ['missions', 'list', { tab, q, page }],
    queryFn: ({ signal }) => api.listMissions({ query: { status: tab, ...(q ? { q } : {}), page, pageSize: PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });

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

      <MissionTabs tabs={TABS} tab={tab} label={t('missions.tabsLabel')} tabLabel={(id) => t(`missions.tabs.${id}`)} onSelect={(id) => update({ tab: id, page: null })} />

      <div id="missions-panel" role="tabpanel" aria-labelledby={`missions-tab-${tab}`}>
        <MissionSearch draft={draft} onDraft={setDraft} onSubmit={submit} />

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
            <Pager page={page} pages={pages} onPage={(next) => update({ page: String(next) })} />
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
