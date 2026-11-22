import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { errorMessage } from '../i18n/error-message';
import { useCoordinators, useUpdateUser } from './queries';
import { ROLE_LABEL } from './users-section';

export type Role = 'admin' | 'coordinator' | 'rescuer';
const ROLES: readonly Role[] = ['rescuer', 'coordinator', 'admin'];

/** La persona sobre la que se actúa: lo justo para los diálogos. */
export interface Target {
  id: string;
  name: string;
  role: Role;
  /** Misiones no cerradas de las que es responsable (RN-11). */
  openMissions: number;
  /** Es la persona de la sesión: cambiarse el rol o desactivarse tiene consecuencias propias. */
  self?: boolean;
}

interface DialogProps {
  target: Target;
  onClose: () => void;
}

/** Lo que el servidor contesta a un cambio: qué texto enseñar y si pide reasignar misiones (`COORDINATOR_HAS_MISSIONS`, RN-11). */
function useOutcome(userId: string) {
  const { t } = useTranslation();
  const update = useUpdateUser(userId);
  const [missionCount, setMissionCount] = useState<number | null>(null);
  const [reassignRequired, setReassignRequired] = useState(false);
  const error = update.error;
  let message = '';
  if (update.isError && !(error instanceof ApiError && error.code === 'COORDINATOR_HAS_MISSIONS')) {
    if (error instanceof ApiError && error.code === 'LAST_ADMIN') message = t('admin.user.lastAdmin');
    else if (error instanceof ApiError && error.code === 'INVALID_STATE_TRANSITION') message = t('admin.user.staleState');
    else message = errorMessage(t, error);
  }
  const onMissions = (failure: unknown) => {
    if (!(failure instanceof ApiError) || failure.code !== 'COORDINATOR_HAS_MISSIONS') return;
    const ids = failure.details?.['missionIds'];
    setMissionCount(Array.isArray(ids) ? ids.length : null);
    setReassignRequired(true);
  };
  return { update, message, missionCount, reassignRequired, onMissions };
}

/** Quién asume las misiones abiertas: los coordinadores activos menos la propia persona. Sin elección previa. */
function ReassignField({ excludeId, count, value, onChange, missing }: { excludeId: string; count: number | null; value: string; onChange: (id: string) => void; missing: boolean }) {
  const { t } = useTranslation();
  const coordinators = useCoordinators();
  const selectId = useId();
  const errorId = useId();
  const options = (coordinators.data?.items ?? []).filter((item) => item.id !== excludeId);
  return (
    <fieldset className="role-choice">
      <legend>{t('admin.user.reassign.legend')}</legend>
      <p className="form-note">{t('admin.user.reassign.explain')}</p>
      <p className="dialog-count" role="status">
        {count !== null ? t('admin.user.reassign.count', { count }) : t('admin.user.reassign.countUnknown')}
      </p>
      {coordinators.isPending && <p className="form-note">{t('admin.user.reassign.loading')}</p>}
      {coordinators.isError && (
        <p className="field-error" role="alert">
          {t('admin.user.reassign.loadFailed')}
        </p>
      )}
      {coordinators.isSuccess && options.length === 0 && (
        <p className="field-error" role="alert">
          {t('admin.user.reassign.none')}
        </p>
      )}
      {options.length > 0 && (
        <div className="field">
          <label htmlFor={selectId}>{t('admin.user.reassign.label')}</label>
          <select id={selectId} value={value} aria-describedby={missing ? errorId : undefined} aria-invalid={missing || undefined} onChange={(event) => onChange(event.target.value)}>
            <option value="">{t('admin.user.reassign.placeholder')}</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
          {missing && (
            <p id={errorId} className="field-error" role="alert">
              {t('admin.user.reassign.required')}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

function Actions({ pending, confirmLabel, onConfirm, onClose }: { pending: boolean; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="dialog-actions">
      <button type="button" className="button button-primary" disabled={pending} onClick={onConfirm}>
        {pending ? t('admin.user.working') : confirmLabel}
      </button>
      {/* El foco empieza en «Cancelar»: confirmar un cambio de cuenta nunca es lo que pasa con un Intro sin pensar. */}
      <button type="button" className="button button-secondary" data-autofocus="" disabled={pending} onClick={onClose}>
        {t('admin.user.cancel')}
      </button>
    </div>
  );
}

/**
 * Cambiar el rol (RN-25, INV-29, D-U2): se elige a propósito y sin opción previa; coordinador y administrador avisan de que
 * conceden permisos. Si la persona es coordinador con misiones abiertas, pide quién las asume. Solo se envía `role`.
 */
export function ChangeRoleDialog({ target, onClose, onDone }: DialogProps & { onDone: (role: Role) => void }) {
  const { t } = useTranslation();
  const { update, message, missionCount, reassignRequired, onMissions } = useOutcome(target.id);
  const [role, setRole] = useState<Role | null>(null);
  const [missingRole, setMissingRole] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [missingReassign, setMissingReassign] = useState(false);
  const group = useRef<HTMLFieldSetElement>(null);
  const groupName = useId();
  const roleErrorId = useId();
  const needsReassign = (target.role === 'coordinator' && target.openMissions > 0) || reassignRequired;

  const confirm = () => {
    if (update.isPending) return;
    if (!role) {
      setMissingRole(true);
      group.current?.querySelector('input')?.focus();
      return;
    }
    if (needsReassign && !reassignTo) {
      setMissingReassign(true);
      return;
    }
    update.mutate(needsReassign ? { role, reassignMissionsTo: reassignTo } : { role }, { onSuccess: () => onDone(role), onError: onMissions });
  };

  return (
    <Dialog title={t('admin.user.roleDialog.title', { name: target.name })} description={
        <>
          <p>{t('admin.user.roleDialog.description')}</p>
          {target.self && <p className="dialog-warning">{t('admin.user.roleDialog.selfWarning')}</p>}
        </>
      } onClose={() => !update.isPending && onClose()}>
      <fieldset ref={group} className="role-choice" aria-describedby={missingRole ? roleErrorId : undefined}>
        <legend>{t('admin.user.roleDialog.legend')}</legend>
        {ROLES.filter((option) => option !== target.role).map((option) => (
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
              <span className="form-note">{t(option === 'admin' ? 'admin.user.roleDialog.adminHelp' : `admin.signups.approveDialog.${option}Help`)}</span>
            </span>
          </label>
        ))}
        {missingRole && (
          <p id={roleErrorId} className="field-error" role="alert">
            {t('admin.user.roleDialog.roleRequired')}
          </p>
        )}
      </fieldset>
      <div role="status">
        {role && <p className="dialog-count">{t('admin.user.roleDialog.summary', { role: t(ROLE_LABEL[role]) })}</p>}
        {role === 'coordinator' && <p className="dialog-warning">{t('admin.signups.approveDialog.coordinatorWarning')}</p>}
        {role === 'admin' && <p className="dialog-warning">{t('admin.user.roleDialog.adminWarning')}</p>}
      </div>
      {needsReassign && (
        <ReassignField
          excludeId={target.id}
          count={missionCount ?? (target.openMissions > 0 ? target.openMissions : null)}
          value={reassignTo}
          onChange={(id) => {
            setReassignTo(id);
            setMissingReassign(false);
          }}
          missing={missingReassign}
        />
      )}
      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}
      <Actions pending={update.isPending} confirmLabel={t('admin.user.roleDialog.confirm')} onConfirm={confirm} onClose={onClose} />
    </Dialog>
  );
}

/**
 * Desactivar la cuenta (RN-11, INV-25): con confirmación. Si es responsable de misiones abiertas (o el servidor lo dice con
 * `COORDINATOR_HAS_MISSIONS`) pide quién las asume y lo envía con el cambio, en una sola petición.
 */
export function DisableDialog({ target, onClose, onDone }: DialogProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const { update, message, missionCount, reassignRequired, onMissions } = useOutcome(target.id);
  const [reassignTo, setReassignTo] = useState('');
  const [missingReassign, setMissingReassign] = useState(false);
  const needsReassign = (target.role === 'coordinator' && target.openMissions > 0) || reassignRequired;

  const confirm = () => {
    if (update.isPending) return;
    if (needsReassign && !reassignTo) {
      setMissingReassign(true);
      return;
    }
    update.mutate(needsReassign ? { accountStatus: 'disabled', reassignMissionsTo: reassignTo } : { accountStatus: 'disabled' }, { onSuccess: onDone, onError: onMissions });
  };

  return (
    <Dialog title={t('admin.user.disableDialog.title', { name: target.name })} description={
        <>
          <p>{t('admin.user.disableDialog.description')}</p>
          {target.self && <p className="dialog-warning">{t('admin.user.disableDialog.selfWarning')}</p>}
        </>
      } onClose={() => !update.isPending && onClose()}>
      {needsReassign && (
        <ReassignField
          excludeId={target.id}
          count={missionCount ?? (target.openMissions > 0 ? target.openMissions : null)}
          value={reassignTo}
          onChange={(id) => {
            setReassignTo(id);
            setMissingReassign(false);
          }}
          missing={missingReassign}
        />
      )}
      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}
      <Actions pending={update.isPending} confirmLabel={t('admin.user.disableDialog.confirm')} onConfirm={confirm} onClose={onClose} />
    </Dialog>
  );
}

/** Reactivar una cuenta desactivada: solo `accountStatus: 'active'`. */
export function ReactivateDialog({ target, onClose, onDone }: DialogProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const { update, message } = useOutcome(target.id);
  const confirm = () => {
    if (!update.isPending) update.mutate({ accountStatus: 'active' }, { onSuccess: onDone });
  };
  return (
    <Dialog title={t('admin.user.reactivateDialog.title', { name: target.name })} description={<p>{t('admin.user.reactivateDialog.description')}</p>} onClose={() => !update.isPending && onClose()}>
      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}
      <Actions pending={update.isPending} confirmLabel={t('admin.user.reactivateDialog.confirm')} onConfirm={confirm} onClose={onClose} />
    </Dialog>
  );
}
