import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/dialog';
import { ErrorState, LoadingState } from '../components/states';
import { errorMessage } from '../i18n/error-message';
import { formatDateTime } from '../missions/format';
import { useInviteCode, useRotateInviteCode } from './queries';

/**
 * Código de invitación (RF-104, D-A5, D-A6): se pide al abrir la vista y se muestra tal cual lo da el servidor, para poder copiarlo.
 * Regenerarlo invalida el anterior en el acto, así que pide confirmación. Copiar usa el portapapeles solo si el navegador lo ofrece
 * (no lo hace fuera de HTTPS o `localhost`): si no, el código sigue a la vista para copiarlo a mano.
 */
export function InviteCodeSection() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const invite = useInviteCode();
  const current = invite.data;
  const rotate = useRotateInviteCode();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (code: string) => {
    setMessage('');
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setMessage(t('admin.inviteCode.copied'));
    } catch {
      setCopyFailed(true);
    }
  };

  const close = () => {
    if (rotate.isPending) return;
    rotate.reset();
    setConfirming(false);
  };

  const confirm = () => {
    if (rotate.isPending) return;
    rotate.mutate(undefined, {
      onSuccess: () => {
        setCopyFailed(false);
        setMessage(t('admin.inviteCode.rotated'));
        setConfirming(false);
      },
    });
  };

  return (
    <section className="admin-section" aria-labelledby="invite-title">
      <h2 id="invite-title">{t('admin.inviteCode.title')}</h2>
      <p className="field-help admin-intro">{t('admin.inviteCode.intro')}</p>

      {invite.isPending && <LoadingState />}
      {invite.isError && <ErrorState error={invite.error} onRetry={() => void invite.refetch()} />}
      {current && (
        <div className="invite-code">
          <p className="invite-code-label">{t('admin.inviteCode.codeLabel')}</p>
          <p className="invite-code-line">
            <code translate="no">{current.code}</code>
          </p>
          <p className="field-help">{t('admin.inviteCode.rotatedAt', { date: formatDateTime(current.rotatedAt, locale) })}</p>
          <div className="point-row-actions">
            <button type="button" className="button button-secondary" onClick={() => void copy(current.code)}>
              {t('admin.inviteCode.copy')}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>
              {t('admin.inviteCode.rotate')}
            </button>
          </div>
        </div>
      )}
      <div role="status" className="admin-result">
        {message && <p className="notice">{message}</p>}
      </div>
      {copyFailed && (
        <p className="field-error" role="alert">
          {t('admin.inviteCode.copyFailed')}
        </p>
      )}

      {confirming && (
        <Dialog title={t('admin.inviteCode.rotateTitle')} description={<p>{t('admin.inviteCode.rotateDescription')}</p>} onClose={close}>
          {rotate.isError && (
            <p className="field-error" role="alert">
              {errorMessage(t, rotate.error)}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button button-primary" disabled={rotate.isPending} onClick={confirm}>
              {rotate.isPending ? t('admin.inviteCode.rotating') : t('admin.inviteCode.rotateConfirm')}
            </button>
            <button type="button" className="button button-secondary" data-autofocus disabled={rotate.isPending} onClick={close}>
              {t('admin.inviteCode.rotateCancel')}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
