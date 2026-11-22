import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { EnvironmentSection } from '../environment/environment-section';
import { MissionSearch, MissionTabs, Pager, useListState } from '../missions/list-controls';
import { StatusBadge } from '../missions/status-badge';
import { missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';

type Tab = 'active' | 'closed';
type Item = OperationOutput<'listMyMissions'>['items'][number];

const TABS: readonly Tab[] = ['active', 'closed'];
const PAGE_SIZE = 20;

/**
 * Mis misiones (RF-601, boceto 14): lo primero que ve el rescatista. Arriba, la versión reducida del inicio (el tiempo de su
 * ubicación; el del objetivo está en el detalle de cada misión, doc 02 §3.2); debajo, las misiones activas y cerradas de su organización con el
 * estado de su oferta. Solo lectura: no hay ningún control de escritura ni botón de oferta (llega en H6).
 */
export function MyMissionsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const locale = i18n.resolvedLanguage ?? 'es';
  usePageTitle(t('myMissions.title'));
  const { tab, q, page, draft, setDraft, update, submit } = useListState(TABS, 'active');

  const missions = useQuery({
    queryKey: ['my-missions', 'list', { tab, q, page }],
    queryFn: ({ signal }) => api.listMyMissions({ query: { status: tab, ...(q ? { q } : {}), page, pageSize: PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });

  const data = missions.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page-wide-flow">
      <h1>{t('myMissions.title')}</h1>

      <EnvironmentSection mission={null} missionHint="open" locale={locale} />

      <MissionTabs tabs={TABS} tab={tab} label={t('myMissions.tabsLabel')} tabLabel={(id) => t(`myMissions.tabs.${id}`)} onSelect={(id) => update({ tab: id, page: null })} />

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
              ) : undefined
            }
          >
            {q ? t('missions.emptySearch', { query: q }) : t(`myMissions.empty.${tab}`)}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <>
            <p className="result-count" role="status">
              {t('missions.summary', { total: data.total })}
            </p>
            <ul className="mission-list" aria-busy={missions.isFetching}>
              {data.items.map((item) => (
                <MyMissionCard key={item.id} item={item} />
              ))}
            </ul>
            <Pager page={page} pages={pages} onPage={(next) => update({ page: String(next) })} />
          </>
        )}
      </div>
    </div>
  );
}

function MyMissionCard({ item }: { item: Item }) {
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
          {/* La política de `users` solo deja leer el nombre al personal: hasta que se decida lo contrario llega `null` y se dice en neutro. */}
          <dd>{item.coordinatorName ?? t('myMissions.coordinatorNeutral')}</dd>
        </div>
        <div>
          <dt>{t('missions.fields.objective')}</dt>
          <dd>{objective}</dd>
        </div>
        <div>
          <dt>{t('myMissions.participation.label')}</dt>
          <dd>{item.myParticipation ? t(`myMissions.participation.status.${item.myParticipation.status}`) : t('myMissions.participation.none')}</dd>
        </div>
      </dl>
    </li>
  );
}
