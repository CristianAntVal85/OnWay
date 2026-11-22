import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { MissionTabs, Pager, useListState } from '../missions/list-controls';
import { TeamFormDialog } from './team-form-dialog';
import { TEAM_STATUSES, useTeams } from './queries';

type Item = OperationOutput<'listTeams'>['items'][number];

/**
 * Equipos (RF-801, boceto 12, doc 02 §3.8): pestañas Activos y Archivados, búsqueda por nombre o localidad y paginación, todo en la dirección.
 * Cada fila lleva nombre, localidad, código y número de miembros: nunca nombres de personas ni contacto (RN-21).
 */
export function TeamsPage() {
  const { t } = useTranslation();
  usePageTitle(t('teams.title'));
  const { tab, q, page, draft, setDraft, update, submit } = useListState(TEAM_STATUSES, 'active');
  const teams = useTeams({ status: tab, q, page });
  const [form, setForm] = useState<{ team?: Item } | null>(null);

  const data = teams.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const createButton = (
    <button type="button" className="button button-primary" onClick={() => setForm({})}>
      {t('teams.createCta')}
    </button>
  );

  return (
    <>
      <div className="page-heading">
        <h1>{t('teams.title')}</h1>
        {createButton}
      </div>

      <MissionTabs tabs={TEAM_STATUSES} tab={tab} label={t('teams.tabsLabel')} tabLabel={(id) => t(`teams.tabs.${id}`)} onSelect={(id) => update({ tab: id, page: null })} idPrefix="teams" />

      <div id="teams-panel" className="page-wide-flow" role="tabpanel" aria-labelledby={`teams-tab-${tab}`}>
        <form className="search-bar" role="search" onSubmit={submit}>
          <div className="field">
            <label htmlFor="teams-search">{t('teams.searchLabel')}</label>
            <div className="field-row">
              <input id="teams-search" type="search" autoComplete="off" spellCheck={false} maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="button button-secondary">
                {t('teams.searchSubmit')}
              </button>
            </div>
          </div>
        </form>

        {teams.isPending && <LoadingState />}
        {teams.isError && <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />}
        {data && data.items.length === 0 && (
          <EmptyState
            action={
              q ? (
                <button type="button" className="button button-secondary" onClick={() => update({ q: null, page: null })}>
                  {t('teams.clearSearch')}
                </button>
              ) : tab === 'active' ? (
                createButton
              ) : undefined
            }
          >
            {q ? t('teams.emptySearch', { query: q }) : t(`teams.empty.${tab}`)}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <>
            <p className="result-count" role="status">
              {t('teams.summary', { total: data.total })}
            </p>
            <ul className="signup-list" aria-busy={teams.isFetching}>
              {data.items.map((item) => (
                <TeamRow key={item.id} item={item} onEdit={() => setForm({ team: item })} />
              ))}
            </ul>
            <Pager page={page} pages={pages} onPage={(next) => update({ page: String(next) })} />
          </>
        )}
      </div>

      {form && <TeamFormDialog {...(form.team ? { team: form.team } : {})} onClose={() => setForm(null)} />}
    </>
  );
}

function TeamRow({ item, onEdit }: { item: Item; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="signup-row user-row team-row">
      <div className="signup-info">
        <span className="signup-name">{item.name}</span>
        <span className="signup-email">{t('teams.row.locality', { locality: item.locality, code: item.code })}</span>
        <span className="signup-date">{t('teams.row.members', { count: item.memberCount })}</span>
      </div>
      <div className="user-badges">
        <button type="button" className="button button-secondary" aria-label={t('teams.row.editLabel', { name: item.name })} onClick={onEdit}>
          {t('teams.row.edit')}
        </button>
      </div>
    </li>
  );
}
