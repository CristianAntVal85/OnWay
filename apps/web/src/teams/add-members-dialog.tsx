import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/dialog';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { errorMessage } from '../i18n/error-message';
import { Pager } from '../missions/list-controls';
import { useAddMembers, useRescuers } from './queries';

/** Lo máximo que admite `addTeamMembers` de una vez (doc 06). */
const MAX_SELECTION = 200;

interface Props {
  teamId: string;
  teamName: string;
  /** Quienes ya son miembros: salen marcados y no se pueden elegir. */
  memberIds: ReadonlySet<string>;
  onClose: () => void;
  onDone: (count: number) => void;
}

/**
 * Añadir miembros (RF-801, D-E5): selector con `listRescuers` (búsqueda y paginación, solo perfiles completos, sin contacto: RN-21). La
 * elección se conserva al cambiar de página y de búsqueda; lo que se envía son los `userIds` elegidos. El servidor decide quién puede entrar.
 */
export function AddMembersDialog({ teamId, teamName, memberIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const searchId = useId();
  const add = useAddMembers(teamId);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const rescuers = useRescuers({ q, page });
  const data = rescuers.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const full = selected.size >= MAX_SELECTION;

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQ(draft.trim());
    setPage(1);
  };
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const confirm = () => {
    if (add.isPending || selected.size === 0) return;
    const count = selected.size;
    add.mutate([...selected], { onSuccess: () => onDone(count) });
  };

  return (
    <Dialog title={t('teams.add.title', { name: teamName })} description={<p>{t('teams.add.description')}</p>} onClose={() => !add.isPending && onClose()}>
      <form className="search-bar" role="search" onSubmit={search}>
        <div className="field">
          <label htmlFor={searchId}>{t('teams.add.searchLabel')}</label>
          <div className="field-row">
            <input id={searchId} type="search" autoComplete="off" spellCheck={false} maxLength={120} data-autofocus="" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" className="button button-secondary">
              {t('teams.searchSubmit')}
            </button>
          </div>
        </div>
      </form>

      {rescuers.isPending && <LoadingState />}
      {rescuers.isError && <ErrorState error={rescuers.error} onRetry={() => void rescuers.refetch()} />}
      {data && data.items.length === 0 && <EmptyState>{q ? t('teams.add.emptySearch', { query: q }) : t('teams.add.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <ul className="picker-list" aria-busy={rescuers.isFetching}>
            {data.items.map((item) => {
              const member = memberIds.has(item.userId);
              const checked = member || selected.has(item.userId);
              const id = `${searchId}-${item.userId}`;
              return (
                <li key={item.userId} className="picker-row">
                  <input
                    id={id}
                    type="checkbox"
                    className="signup-check"
                    checked={checked}
                    disabled={member || (!checked && full)}
                    onChange={() => toggle(item.userId)}
                    aria-describedby={`${id}-info`}
                  />
                  <label htmlFor={id} className="signup-info">
                    <span className="signup-name">{item.displayName}</span>
                    <span id={`${id}-info`} className="signup-date">
                      {member ? t('teams.add.alreadyMember') : item.teams.length > 0 ? item.teams.map((team) => team.name).join(', ') : t('teams.add.noTeams')}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}

      <p className="selection-hint" role="status">
        {selected.size === 0 ? t('teams.add.selectionHint') : full ? t('teams.add.selectionFull', { count: MAX_SELECTION }) : t('teams.add.selectionCount', { count: selected.size })}
      </p>
      {add.isError && (
        <p className="field-error" role="alert">
          {errorMessage(t, add.error)}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button button-primary" disabled={add.isPending || selected.size === 0} onClick={confirm}>
          {add.isPending ? t('teams.add.working') : t('teams.add.confirm', { count: selected.size })}
        </button>
        <button type="button" className="button button-secondary" disabled={add.isPending} onClick={onClose}>
          {t('teams.add.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
