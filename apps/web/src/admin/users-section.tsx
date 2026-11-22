import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { formatDateTime } from '../missions/format';
import { Pager } from '../missions/list-controls';
import { userPath } from '../nav/navigation';
import { useUsers, type UsersQuery } from './queries';

type Item = OperationOutput<'listUsers'>['items'][number];

const SEARCH_DELAY_MS = 300;
const ROLES = ['admin', 'coordinator', 'rescuer'] as const;
const STATUSES = ['active', 'disabled'] as const;
export const ROLE_LABEL = { admin: 'account.roleAdmin', coordinator: 'account.roleCoordinator', rescuer: 'account.roleRescuer' } as const;
// Parámetros propios de la sección (`users.q`…): la bandeja de altas, en la misma página, usa `tab`, `q` y `page`.
const KEYS = { q: 'users.q', role: 'users.role', status: 'users.status', page: 'users.page' } as const;

const pick = <T extends string>(options: readonly T[], raw: string | null): T | '' => options.find((option) => option === raw) ?? '';

/**
 * Usuarios de la organización (boceto 13, RF-813, doc 02 §3.10): búsqueda, filtros de rol y estado y paginación, todo en la dirección
 * (`?users.q=…`). Cada fila lleva a la ficha, que recuerda estos filtros para volver. Solo lista a quien ya es miembro (D-U6).
 */
export function UsersSection() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const q = params.get(KEYS.q) ?? '';
  const role = pick(ROLES, params.get(KEYS.role));
  const accountStatus = pick(STATUSES, params.get(KEYS.status));
  const rawPage = Number(params.get(KEYS.page));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const query: UsersQuery = { q, role, accountStatus, page };
  const users = useUsers(query);
  const searchId = useId();
  const roleId = useId();
  const statusId = useId();

  const update = (changes: Record<string, string | null>) =>
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

  // La búsqueda se aplica al dejar de teclear (o al pulsar Buscar); cambiarla vuelve a la página 1.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const text = draft.trim();
    if (text === q) return;
    const timer = setTimeout(() => update({ [KEYS.q]: text, [KEYS.page]: null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // `update` cambia en cada render; solo importa lo que se ha escrito.
  }, [draft, q]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ [KEYS.q]: draft.trim(), [KEYS.page]: null });
  };

  const data = users.data;
  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(q || role || accountStatus);
  // Lo que la ficha necesita para volver aquí con los mismos filtros.
  const from = location.search;

  return (
    <section className="admin-section" aria-labelledby="users-title">
      <h2 id="users-title">{t('admin.users.title')}</h2>

      <form className="search-bar users-filters" role="search" onSubmit={submit}>
        <div className="field">
          <label htmlFor={searchId}>{t('admin.users.searchLabel')}</label>
          <div className="field-row">
            <input id={searchId} type="search" autoComplete="off" spellCheck={false} maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" className="button button-secondary">
              {t('admin.users.searchSubmit')}
            </button>
          </div>
        </div>
        <div className="users-selects">
          <div className="field">
            <label htmlFor={roleId}>{t('admin.users.roleFilter')}</label>
            <select id={roleId} value={role} onChange={(event) => update({ [KEYS.role]: event.target.value, [KEYS.page]: null })}>
              <option value="">{t('admin.users.all')}</option>
              {ROLES.map((id) => (
                <option key={id} value={id}>
                  {t(ROLE_LABEL[id])}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={statusId}>{t('admin.users.statusFilter')}</label>
            <select id={statusId} value={accountStatus} onChange={(event) => update({ [KEYS.status]: event.target.value, [KEYS.page]: null })}>
              <option value="">{t('admin.users.all')}</option>
              {STATUSES.map((id) => (
                <option key={id} value={id}>
                  {t(`admin.users.status.${id}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>

      {users.isPending && <LoadingState />}
      {users.isError && <ErrorState error={users.error} onRetry={() => void users.refetch()} />}
      {data && items.length === 0 && (
        <EmptyState
          action={
            filtered ? (
              <button type="button" className="button button-secondary" onClick={() => update({ [KEYS.q]: null, [KEYS.role]: null, [KEYS.status]: null, [KEYS.page]: null })}>
                {t('admin.users.clearFilters')}
              </button>
            ) : undefined
          }
        >
          {filtered ? t('admin.users.emptyFiltered') : t('admin.users.empty')}
        </EmptyState>
      )}
      {data && items.length > 0 && (
        <>
          <p className="result-count" role="status">
            {t('admin.users.summary', { total: data.total })}
          </p>
          <ul className="signup-list" aria-busy={users.isFetching}>
            {items.map((item) => (
              <UserRow key={item.userId} item={item} locale={locale} from={from} />
            ))}
          </ul>
          <Pager page={page} pages={pages} onPage={(next) => update({ [KEYS.page]: String(next) })} />
        </>
      )}
    </section>
  );
}

function UserRow({ item, locale, from }: { item: Item; locale: string; from: string }) {
  const { t } = useTranslation();
  return (
    <li className="signup-row user-row">
      <div className="signup-info">
        <Link className="signup-name" to={userPath(item.userId)} state={{ from }}>
          {item.displayName}
        </Link>
        <span className="signup-email">{item.email}</span>
        <span className="signup-date">{item.lastLoginAt ? t('admin.users.lastLogin', { date: formatDateTime(item.lastLoginAt, locale) }) : t('admin.users.neverLoggedIn')}</span>
      </div>
      <div className="user-badges">
        <span className="status-badge">{t(ROLE_LABEL[item.role])}</span>
        <span className="status-badge" data-signup={item.accountStatus === 'disabled' ? 'rejected' : 'approved'}>
          {t(`admin.users.status.${item.accountStatus}`)}
        </span>
      </div>
    </li>
  );
}
