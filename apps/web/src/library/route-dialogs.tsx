import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { errorMessage } from '../i18n/error-message';
import { routePath } from '../nav/navigation';
import { useApi } from '../session/api-context';

interface Common {
  routeId: string;
  onClose: () => void;
}

/** Validar una versión (RF-506): el aviso se confirma con una casilla y el servidor recibe `acknowledged: true`. */
export function ValidateDialog({ routeId, versionId, versionNumber, onClose }: Common & { versionId: string; versionNumber: number }) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [acknowledged, setAcknowledged] = useState(false);
  const [missing, setMissing] = useState(false);
  const validate = useMutation({
    mutationFn: () => api.validateRouteVersion({ params: { routeId, versionId }, body: { acknowledged: true } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!acknowledged) {
      setMissing(true);
      return;
    }
    validate.mutate();
  };
  return (
    <Dialog title={t('routeDetail.validate.title', { number: versionNumber })} description={t('routeDetail.validate.description')} onClose={() => !validate.isPending && onClose()}>
      <form onSubmit={submit} noValidate>
        <p className="dialog-warning">{t('routeDetail.validate.warning')}</p>
        <label className="check-row">
          <input
            type="checkbox"
            data-autofocus
            checked={acknowledged}
            aria-describedby={missing ? 'validate-missing' : undefined}
            onChange={(event) => {
              setAcknowledged(event.target.checked);
              setMissing(false);
            }}
          />
          <span>{t('routeDetail.validate.acknowledge')}</span>
        </label>
        {missing && (
          <p id="validate-missing" className="field-error" role="alert">
            {t('routeDetail.validate.needsAcknowledge')}
          </p>
        )}
        {validate.isError && (
          <p role="alert">{validate.error instanceof ApiError && validate.error.code === 'VERSION_IMMUTABLE' ? t('routeDetail.validate.immutable') : errorMessage(t, validate.error)}</p>
        )}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={validate.isPending}>
            {validate.isPending ? t('routeDetail.validate.working') : t('routeDetail.validate.confirm')}
          </button>
          <button type="button" className="button button-secondary" disabled={validate.isPending} onClick={onClose}>
            {t('routeDetail.validate.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Derivar (RF-517): una ruta nueva con una copia de la versión; la original no cambia. */
export function DeriveDialog({ routeId, versionId, versionNumber, defaultName, onClose }: Common & { versionId: string; versionNumber: number; defaultName: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [missing, setMissing] = useState(false);
  const derive = useMutation({
    mutationFn: (value: string) => api.deriveRoute({ params: { routeId }, body: { name: value, fromVersionId: versionId } }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      onClose();
      navigate(routePath(created.routeId));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setMissing(true);
      return;
    }
    derive.mutate(value);
  };
  return (
    <Dialog title={t('routeDetail.derive.title')} description={t('routeDetail.derive.description', { number: versionNumber })} onClose={() => !derive.isPending && onClose()}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="derive-name">{t('routeDetail.derive.nameLabel')}</label>
          <input
            id="derive-name"
            data-autofocus
            type="text"
            maxLength={160}
            value={name}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? 'derive-name-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setMissing(false);
            }}
          />
          {missing && (
            <p id="derive-name-error" className="field-error" role="alert">
              {t('routeDetail.derive.nameRequired')}
            </p>
          )}
        </div>
        {derive.isError && <p role="alert">{errorMessage(t, derive.error)}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={derive.isPending}>
            {derive.isPending ? t('routeDetail.derive.working') : t('routeDetail.derive.confirm')}
          </button>
          <button type="button" className="button button-secondary" disabled={derive.isPending} onClick={onClose}>
            {t('routeDetail.derive.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Archivar: si hay misiones sin cerrar que la usan, las lista (`ROUTE_IN_USE`). */
export function ArchiveDialog({ routeId, onClose }: Common) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const archive = useMutation({
    mutationFn: () => api.archiveRoute({ params: { routeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      onClose();
    },
  });
  const inUse =
    archive.error instanceof ApiError && archive.error.code === 'ROUTE_IN_USE' ? ((archive.error.details as { missions?: { id: string; name: string }[] } | undefined)?.missions ?? []) : null;
  return (
    <Dialog title={t('routeDetail.archive.title')} description={t('routeDetail.archive.description')} onClose={() => !archive.isPending && onClose()}>
      {inUse && (
        <div role="alert">
          <p>{t('routeDetail.archive.inUse', { missions: inUse.map((mission) => mission.name).join(', ') })}</p>
        </div>
      )}
      {archive.isError && !inUse && <p role="alert">{errorMessage(t, archive.error)}</p>}
      <div className="dialog-actions">
        <button type="button" className="button button-primary" data-autofocus disabled={archive.isPending} onClick={() => archive.mutate()}>
          {archive.isPending ? t('routeDetail.archive.working') : t('routeDetail.archive.confirm')}
        </button>
        <button type="button" className="button button-secondary" disabled={archive.isPending} onClick={onClose}>
          {t('routeDetail.archive.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
