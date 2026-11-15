import { Menu } from '../components/menu';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { missionChangedMeanwhile, writeFailureMessage } from './errors';

type Mission = OperationOutput<'getMission'>;

const NAME_MIN = 3;
const NAME_MAX = 120;

type Busy = 'activate' | 'close' | 'reopen' | 'duplicate' | null;
type Step = 'activate-warning' | 'close' | 'duplicate' | null;

/** Lo que la página debe saber cuando una acción termina: qué anunciar (o nada) y que el foco vuelva al título. */
export interface LifecycleResult {
  message: string | null;
}

interface Props {
  mission: Mission;
  onSettled: (result: LifecycleResult) => void;
  /** «Editar datos», si se puede editar: va en el menú «Más» junto a Duplicar (D-S4). */
  onEdit?: () => void;
}

/** Nombre propuesto para la copia: el original con «(copia)», recortado para no pasar de 120 caracteres. */
function proposedName(name: string, suffixed: (name: string) => string): string {
  const full = suffixed(name);
  if (full.length <= NAME_MAX) return full;
  const room = NAME_MAX - suffixed('').length;
  return suffixed(name.slice(0, Math.max(room, 0)).trimEnd());
}

/**
 * Acciones del ciclo de vida de la misión (RF-202, RF-203, RF-207, RF-208): Activar, Cerrar, Reabrir y Duplicar, según `actions`.
 * Quien decide qué se puede hacer es el servidor: aquí solo se pintan los botones y se explican sus respuestas.
 * Sin voluntarios en H1, el cierre solo confirma (doc 02 §4.5) y envía una asistencia vacía.
 */
export function LifecycleActions({ mission, onSettled, onEdit }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Busy>(null);
  const [step, setStep] = useState<Step>(null);
  // Fallo de una acción sin diálogo (o cuyo diálogo ya se cerró) y fallo dentro del diálogo abierto.
  const [blockError, setBlockError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const { actions } = mission;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['missions'] });

  const messageFor = (error: unknown): string => {
    if (error instanceof ApiError && error.code === 'INVALID_STATE_TRANSITION') return t('missionDetail.lifecycle.invalidTransition');
    return writeFailureMessage(t, error);
  };

  /** Se llama con el fallo de cualquiera de las acciones; devuelve `true` si ya está tratado. */
  const fail = async (error: unknown, dialogOpen: boolean, own?: (error: ApiError) => string | null) => {
    const handled = error instanceof ApiError ? own?.(error) : null;
    const changed = missionChangedMeanwhile(error) || (error instanceof ApiError && error.code === 'INVALID_STATE_TRANSITION');
    const text = handled ?? messageFor(error);
    if (changed) {
      // Otra persona cambió la misión: se cierra el diálogo, se vuelve a leer y se explica en la cabecera.
      setStep(null);
      setDialogError(null);
      setBlockError(text);
      onSettled({ message: null });
      await refresh();
      return;
    }
    if (dialogOpen) setDialogError(text);
    else {
      setBlockError(text);
    }
  };

  const succeed = async (message: string) => {
    await refresh();
    setStep(null);
    setBlockError(null);
    setDialogError(null);
    onSettled({ message });
  };

  const activate = async (confirmed: boolean) => {
    if (busy) return;
    setBusy('activate');
    setBlockError(null);
    setDialogError(null);
    try {
      await api.activateMission({ params: { missionId: mission.id }, body: confirmed ? { confirmWithoutValidatedRoute: true } : {} });
      await succeed(t('missionDetail.lifecycle.activated'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFIRMATION_REQUIRED' && !confirmed) setStep('activate-warning');
      else await fail(error, step !== null);
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    if (busy) return;
    setBusy('close');
    setDialogError(null);
    try {
      await api.closeMission({ params: { missionId: mission.id }, body: { attendance: [] } });
      await succeed(t('missionDetail.lifecycle.closed'));
    } catch (error) {
      await fail(error, true);
    } finally {
      setBusy(null);
    }
  };

  const reopen = async () => {
    if (busy) return;
    setBusy('reopen');
    setBlockError(null);
    try {
      await api.reopenMission({ params: { missionId: mission.id } });
      await succeed(t('missionDetail.lifecycle.reopened'));
    } catch (error) {
      await fail(error, false, (apiError) => (apiError.code === 'DUPLICATE_NAME' ? t('missionDetail.lifecycle.reopenDuplicateName') : null));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (name: string) => {
    if (busy) return;
    setBusy('duplicate');
    setDialogError(null);
    setNameError(null);
    try {
      const copy = await api.duplicateMission({ params: { missionId: mission.id }, body: { name } });
      await refresh();
      navigate(missionPath(copy.id), { state: { duplicatedFrom: mission.name } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE_NAME') setNameError(t('createMission.duplicateName'));
      else await fail(error, true);
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    if (busy) return;
    setStep(null);
    setDialogError(null);
    setNameError(null);
  };

  const label = (idle: string, working: string, kind: Exclude<Busy, null>) => (busy === kind ? working : idle);

  return (
    <div className="lifecycle">
      <div role="alert" className="form-alert">
        {blockError && <p>{blockError}</p>}
      </div>
      {(actions.activate || actions.close || actions.reopen || actions.duplicate || onEdit) && (
        <div className="lifecycle-actions" role="group" aria-label={t('missionDetail.lifecycle.groupLabel')}>
          {actions.activate && (
            <button type="button" className="button button-primary" aria-disabled={busy !== null} onClick={() => void activate(false)}>
              {label(t('missionDetail.lifecycle.activate'), t('missionDetail.lifecycle.activating'), 'activate')}
            </button>
          )}
          {actions.close && (
            <button
              id="mission-close-button"
              type="button"
              className="button button-primary"
              aria-disabled={busy !== null}
              onClick={() => {
                if (busy) return;
                setBlockError(null);
                setStep('close');
              }}
            >
              {t('missionDetail.lifecycle.close')}
            </button>
          )}
          {actions.reopen && (
            <button type="button" className="button button-primary" aria-disabled={busy !== null} onClick={() => void reopen()}>
              {label(t('missionDetail.lifecycle.reopen'), t('missionDetail.lifecycle.reopening'), 'reopen')}
            </button>
          )}
          {(onEdit || actions.duplicate) && (
            <Menu
              buttonId="mission-edit-button"
              label={t('common.more')}
              icon="more"
              iconOnly
              align="end"
              disabled={busy !== null}
              items={[
                ...(onEdit ? [{ id: 'edit', label: t('missionDetail.editData'), icon: 'edit' as const, onSelect: onEdit }] : []),
                ...(actions.duplicate
                  ? [
                      {
                        id: 'duplicate',
                        label: t('missionDetail.lifecycle.duplicate'),
                        icon: 'copy' as const,
                        onSelect: () => {
                          setBlockError(null);
                          setStep('duplicate');
                        },
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      )}

      {step === 'activate-warning' && (
        <Dialog title={t('missionDetail.lifecycle.activateWarning.title')} description={<p>{t('missionDetail.lifecycle.activateWarning.body')}</p>} onClose={cancel}>
          <DialogError text={dialogError} />
          <div className="dialog-actions">
            <button type="button" className="button button-primary" aria-disabled={busy !== null} onClick={() => void activate(true)}>
              {label(t('missionDetail.lifecycle.activateWarning.confirm'), t('missionDetail.lifecycle.activating'), 'activate')}
            </button>
            <button type="button" data-autofocus className="button button-secondary" onClick={cancel}>
              {t('missionDetail.lifecycle.activateWarning.cancel')}
            </button>
          </div>
        </Dialog>
      )}

      {step === 'close' && (
        <Dialog
          title={t('missionDetail.lifecycle.closeDialog.title')}
          description={
            <>
              <p>{t('missionDetail.lifecycle.closeDialog.body')}</p>
              <p>{t('missionDetail.lifecycle.closeDialog.noParticipants')}</p>
            </>
          }
          onClose={cancel}
        >
          <DialogError text={dialogError} />
          <div className="dialog-actions">
            <button type="button" className="button button-primary" aria-disabled={busy !== null} onClick={() => void close()}>
              {label(t('missionDetail.lifecycle.closeDialog.confirm'), t('missionDetail.lifecycle.closing'), 'close')}
            </button>
            <button type="button" data-autofocus className="button button-secondary" onClick={cancel}>
              {t('missionDetail.lifecycle.closeDialog.cancel')}
            </button>
          </div>
        </Dialog>
      )}

      {step === 'duplicate' && (
        <DuplicateDialog
          pending={busy === 'duplicate'}
          nameError={nameError}
          error={dialogError}
          onNameChange={() => setNameError(null)}
          onSubmit={(name) => void duplicate(name)}
          onCancel={cancel}
          initialName={proposedName(mission.name, (name) => t('missionDetail.lifecycle.duplicateDialog.defaultName', { name }))}
        />
      )}
    </div>
  );
}

function DialogError({ text }: { text: string | null }) {
  return (
    <div role="alert" className="form-alert">
      {text && <p>{text}</p>}
    </div>
  );
}

interface DuplicateProps {
  initialName: string;
  pending: boolean;
  nameError: string | null;
  error: string | null;
  onNameChange: () => void;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Duplicar pide el nombre nuevo (RF-203): tiene que cumplir las mismas reglas que al crear una misión. */
function DuplicateDialog({ initialName, pending, nameError, error, onNameChange, onSubmit, onCancel }: DuplicateProps) {
  const { t } = useTranslation();
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [showError, setShowError] = useState(false);

  useEffect(() => input.current?.select(), []);

  const trimmed = name.trim();
  const valid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
  const shown = nameError ?? (showError && !valid ? t('createMission.nameInvalid') : null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!valid) {
      setShowError(true);
      input.current?.focus();
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <Dialog title={t('missionDetail.lifecycle.duplicateDialog.title')} description={<p>{t('missionDetail.lifecycle.duplicateDialog.body')}</p>} onClose={onCancel}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${uid}-name`}>{t('missionDetail.lifecycle.duplicateDialog.name')}</label>
          <input
            id={`${uid}-name`}
            ref={input}
            data-autofocus
            type="text"
            autoComplete="off"
            maxLength={NAME_MAX + 40}
            value={name}
            aria-invalid={shown !== null}
            aria-describedby={shown ? `${uid}-error` : undefined}
            onChange={(event) => {
              setName(event.target.value);
              onNameChange();
            }}
          />
          {shown && (
            <p id={`${uid}-error`} className="field-error" role="alert">
              {shown}
            </p>
          )}
        </div>
        <DialogError text={error} />
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" aria-disabled={pending}>
            {pending ? t('missionDetail.lifecycle.duplicateDialog.creating') : t('missionDetail.lifecycle.duplicateDialog.confirm')}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            {t('missionDetail.lifecycle.duplicateDialog.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
