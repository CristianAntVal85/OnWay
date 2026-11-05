import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { formatDateTime } from '../missions/format';
import { MissionTabs, Pager, useListState } from '../missions/list-controls';
import { DecideDialog, type Decision } from './decide-dialog';
import { SIGNUP_STATUSES, useSignupRequests } from './queries';

type Item = OperationOutput<'listSignupRequests'>['items'][number];

/**
 * Solicitudes de alta (boceto 13, RF-106): bandeja con casillas, filtro por estado, búsqueda y paginación, y acciones en bloque
 * (aprobar eligiendo el rol, rechazar) con confirmación. Estado, búsqueda y página viven en la dirección. La selección es la de
 * la página que se ve: al cambiar de pestaña, búsqueda o página se vacía, para no decidir sobre filas que ya no se ven.
 */
export function SignupInbox() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const { tab, q, page, draft, setDraft, update, submit } = useListState(SIGNUP_STATUSES, 'pending');
  const signups = useSignupRequests({ status: tab, q, page });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Quién entra en la decisión se fija al abrir el diálogo: lo que confirma la persona es lo que se envía.
  const [dialog, setDialog] = useState<{ action: 'approve' | 'reject'; people: { id: string; name: string }[] } | null>(null);
  const [done, setDone] = useState('');
  const [stale, setStale] = useState(false);
  const [focusHeading, setFocusHeading] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const searchId = useId();

  const data = signups.data;
  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const selectable = items.filter((item) => item.status === 'pending');
  // Solo cuenta lo que sigue a la vista y pendiente: si otra persona decide una fila mientras tanto, deja de estar seleccionada.
  const chosen = selectable.filter((item) => selected.has(item.userId));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  useEffect(() => {
    setSelected(new Set());
    setDone('');
    setStale(false);
  }, [tab, q, page]);

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);

  // Tras decidir, el botón que abrió el diálogo ya no existe (la selección se vacía): el foco pasa al título de la sección.
  useEffect(() => {
    if (focusHeading > 0) heading.current?.focus();
  }, [focusHeading]);

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const finish = () => {
    setDialog(null);
    setSelected(new Set());
    setFocusHeading((n) => n + 1);
  };

  const onDecided = (decision: Decision) => {
    setStale(false);
    setDone(
      decision.action === 'approve' && decision.role
        ? t('admin.signups.approved', { role: t(decision.role === 'coordinator' ? 'account.roleCoordinator' : 'account.roleRescuer').toLowerCase(), count: decision.affected })
        : t('admin.signups.rejected', { count: decision.affected }),
    );
    finish();
  };

  const onStale = () => {
    setDone('');
    setStale(true);
    finish();
  };

  const open = (action: 'approve' | 'reject') => setDialog({ action, people: chosen.map((item) => ({ id: item.userId, name: item.displayName })) });

  return (
    <section className="admin-section" aria-labelledby="signups-title">
      <h2 id="signups-title" ref={heading} tabIndex={-1}>
        {t('admin.signups.title')}
      </h2>
      <p className="field-help admin-intro">{t('admin.signups.intro')}</p>

      <MissionTabs
        idPrefix="signups"
        tabs={SIGNUP_STATUSES}
        tab={tab}
        label={t('admin.signups.tabsLabel')}
        tabLabel={(id) => t(`admin.signups.tabs.${id}`)}
        onSelect={(id) => update({ tab: id, page: null })}
      />

      <div id="signups-panel" role="tabpanel" aria-labelledby={`signups-tab-${tab}`} className="signups-panel">
        <form className="search-bar" role="search" onSubmit={submit}>
          <div className="field">
            <label htmlFor={searchId}>{t('admin.signups.searchLabel')}</label>
            <div className="field-row">
              <input id={searchId} type="search" autoComplete="off" spellCheck={false} maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="button button-secondary">
                {t('admin.signups.searchSubmit')}
              </button>
            </div>
          </div>
        </form>

        <div role="status" className="admin-result">
          {done && <p className="notice">{done}</p>}
        </div>
        {stale && (
          <p className="notice notice-warning" role="alert">
            {t('admin.signups.stale')}
          </p>
        )}

        {signups.isPending && <LoadingState />}
        {signups.isError && <ErrorState error={signups.error} onRetry={() => void signups.refetch()} />}
        {data && items.length === 0 && (
          <EmptyState
            action={
              q ? (
                <button type="button" className="button button-secondary" onClick={() => update({ q: null, page: null })}>
                  {t('admin.signups.clearSearch')}
                </button>
              ) : undefined
            }
          >
            {q ? t('admin.signups.emptySearch', { query: q }) : t(`admin.signups.empty.${tab}`)}
          </EmptyState>
        )}
        {data && items.length > 0 && (
          <>
            <p className="result-count" role="status">
              {t('admin.signups.summary', { total: data.total })}
            </p>

            {selectable.length > 0 ? (
              <>
                <label className="check-row signup-select-all">
                  <input ref={selectAll} type="checkbox" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(selectable.map((item) => item.userId)))} />
                  <span>{t('admin.signups.selectPage')}</span>
                </label>
                {chosen.length === 0 ? (
                  <p className="selection-hint">{t('admin.signups.selectionHint')}</p>
                ) : (
                  <div className="selection-bar" role="group" aria-label={t('admin.signups.selectionCount', { count: chosen.length })}>
                    <p className="selection-count" role="status">
                      {t('admin.signups.selectionCount', { count: chosen.length })}
                    </p>
                    <div className="selection-buttons">
                      <button type="button" className="button button-primary" onClick={() => open('approve')}>
                        {t('admin.signups.approve')}
                      </button>
                      <button type="button" className="button button-secondary" onClick={() => open('reject')}>
                        {t('admin.signups.reject')}
                      </button>
                      <button type="button" className="button button-secondary" onClick={() => setSelected(new Set())}>
                        {t('admin.signups.clearSelection')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="selection-hint">{t('admin.signups.decidedNote')}</p>
            )}

            <ul className="signup-list" aria-busy={signups.isFetching}>
              {items.map((item) => (
                <SignupRow key={item.userId} item={item} locale={locale} checked={selected.has(item.userId)} onToggle={() => toggle(item.userId)} />
              ))}
            </ul>
            <Pager page={page} pages={pages} onPage={(next) => update({ page: String(next) })} />
          </>
        )}
      </div>

      {dialog && <DecideDialog action={dialog.action} people={dialog.people} onClose={() => setDialog(null)} onDecided={onDecided} onStale={onStale} />}
    </section>
  );
}

function SignupRow({ item, locale, checked, onToggle }: { item: Item; locale: string; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const date = t('admin.signups.requestedOn', { date: formatDateTime(item.requestedAt, locale) });
  const info = (
    <>
      <span id={`${id}-name`} className="signup-name">
        {item.displayName}
      </span>
      <span id={`${id}-email`} className="signup-email">
        {item.email}
      </span>
      <span id={`${id}-date`} className="signup-date">
        {date}
      </span>
    </>
  );
  if (item.status !== 'pending')
    return (
      <li className="signup-row">
        <div className="signup-info">{info}</div>
        <span className="status-badge" data-signup={item.status}>
          {t(`admin.signups.status.${item.status}`)}
        </span>
      </li>
    );
  return (
    <li className="signup-row" data-checked={checked ? '' : undefined}>
      <input id={id} type="checkbox" className="signup-check" checked={checked} onChange={onToggle} aria-labelledby={`${id}-name`} aria-describedby={`${id}-email ${id}-date`} />
      <label htmlFor={id} className="signup-info">
        {info}
      </label>
    </li>
  );
}
