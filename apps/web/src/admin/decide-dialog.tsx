import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { errorMessage } from '../i18n/error-message';
import { useDecideSignups } from './queries';

export type GrantedRole = 'rescuer' | 'coordinator';
const ROLES: readonly GrantedRole[] = ['rescuer', 'coordinator'];
const ROLE_LABEL = { rescuer: 'account.roleRescuer', coordinator: 'account.roleCoordinator' } as const;

export interface Decision {
  action: 'approve' | 'reject';
  role?: GrantedRole;
  affected: number;
}

interface Props {
  action: 'approve' | 'reject';
  people: readonly { id: string; name: string }[];
  onClose: () => void;
  onDecided: (decision: Decision) => void;
  /** Alguien decidió antes alguna de las solicitudes, o ya no existe: no se ha cambiado nada y conviene volver a leer la bandeja. */
  onStale: () => void;
}

/**
 * Confirmación de aprobar o rechazar en bloque (RF-106). Al aprobar el rol se elige a propósito: no hay ninguno marcado de antemano,
 * y elegir coordinador avisa de que concede permisos de edición (RN-25, INV-29). La atomicidad y los permisos son del servidor.
 */
export function DecideDialog({ action, people, onClose, onDecided, onStale }: Props) {
  const { t } = useTranslation();
  const decide = useDecideSignups();
  const [role, setRole] = useState<GrantedRole | null>(null);
  const [missingRole, setMissingRole] = useState(false);
  const group = useRef<HTMLFieldSetElement>(null);
  const groupName = useId();
  const roleErrorId = useId();
  const approving = action === 'approve';
  const T = approving ? 'admin.signups.approveDialog' : 'admin.signups.rejectDialog';

  const confirm = () => {
    if (decide.isPending) return;
    if (approving && !role) {
      setMissingRole(true);
      group.current?.querySelector('input')?.focus();
      return;
    }
    const selection = { mode: 'ids' as const, ids: people.map((person) => person.id) };
    decide.mutate(approving && role ? { action: 'approve', role, selection } : { action: 'reject', selection }, {
      onSuccess: (result) => onDecided({ action, ...(approving && role ? { role } : {}), affected: result.affected }),
      onError: (error) => {
        if (error instanceof ApiError && (error.code === 'INVALID_STATE_TRANSITION' || error.code === 'NOT_FOUND')) onStale();
      },
    });
  };

  return (
    <Dialog title={t(`${T}.title`)} description={<p>{t(`${T}.description`)}</p>} onClose={() => !decide.isPending && onClose()}>
      <p className="dialog-count">{t('admin.signups.people', { count: people.length })}</p>
      <ul className="dialog-list">
        {people.map((person) => (
          <li key={person.id}>{person.name}</li>
        ))}
      </ul>

      {approving && (
        <fieldset ref={group} className="role-choice" aria-describedby={missingRole ? roleErrorId : undefined}>
          <legend>{t('admin.signups.approveDialog.roleLegend')}</legend>
          {ROLES.map((option) => (
            <label key={option} className="role-option">
              <input
                type="radio"
                name={groupName}
                value={option}
                checked={role === option}
                onChange={() => {
                  setRole(option);
                  setMissingRole(false);
                }}
              />
              <span>
                <strong>{t(ROLE_LABEL[option])}</strong>
                <span className="form-note">{t(`admin.signups.approveDialog.${option}Help`)}</span>
              </span>
            </label>
          ))}
          {missingRole && (
            <p id={roleErrorId} className="field-error" role="alert">
              {t('admin.signups.approveDialog.roleRequired')}
            </p>
          )}
        </fieldset>
      )}
      {approving && (
        <div role="status">
          {role && <p className="dialog-count">{t('admin.signups.approveDialog.summary', { role: t(ROLE_LABEL[role]) })}</p>}
          {role === 'coordinator' && <p className="dialog-warning">{t('admin.signups.approveDialog.coordinatorWarning')}</p>}
        </div>
      )}

      {decide.isError && (
        <p className="field-error" role="alert">
          {errorMessage(t, decide.error)}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="button button-primary" data-autofocus={approving ? undefined : ''} disabled={decide.isPending} onClick={confirm}>
          {decide.isPending ? t('admin.signups.working') : t(`${T}.confirm`)}
        </button>
        <button type="button" className="button button-secondary" disabled={decide.isPending} onClick={onClose}>
          {t('admin.signups.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
