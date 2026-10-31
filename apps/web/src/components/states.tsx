import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../i18n/error-message';

/** Cargando: anunciado a los lectores de pantalla sin mover el foco. */
export function LoadingState({ label }: { label?: string } = {}) {
  const { t } = useTranslation();
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label ?? t('state.loading')}</p>
    </div>
  );
}

/** Vacío: dice qué falta y, si se puede, qué hacer. */
export function EmptyState({ title, children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="state state-empty">
      <h2>{title ?? t('state.emptyTitle')}</h2>
      <p>{children ?? t('state.emptyBody')}</p>
      {action}
    </section>
  );
}

/** Error: el texto sale del `code` del servidor; el botón repite la petición. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="state state-error" role="alert">
      <h2>{t('state.errorTitle')}</h2>
      <p>{errorMessage(t, error)}</p>
      {onRetry && (
        <button type="button" className="button button-secondary" onClick={onRetry}>
          {t('state.retry')}
        </button>
      )}
    </section>
  );
}
