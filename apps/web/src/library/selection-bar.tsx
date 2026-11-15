import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { Menu } from '../components/menu';
import { errorMessage } from '../i18n/error-message';
import { useApi } from '../session/api-context';
import { saveBlob } from './download';

/** Lo más que admite `exportRoutes` de una vez. */
export const MAX_EXPORT = 50;

interface Props {
  selected: ReadonlyMap<string, string>;
  canArchive: boolean;
  /** Solo en la lista de archivadas y para quien escribe (issue #17): en las demás vistas el botón de eliminar ni se monta. */
  canDelete: boolean;
  onClear: () => void;
  onArchived: (ids: string[]) => void;
  onDeleted: (ids: string[]) => void;
}

interface Report {
  done: string[];
  failed: { id: string; name: string; message: string }[];
}
type Action = 'archive' | 'delete';

/** Acciones sobre la selección, que se conserva al cambiar de página: exportar (GPX o KML) y, quien puede escribir, archivar (activas) o eliminar (archivadas). */
export function SelectionBar({ selected, canArchive, canDelete, onClear, onArchived, onDeleted }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [report, setReport] = useState<(Report & { action: Action }) | null>(null);
  const count = selected.size;
  const tooMany = count > MAX_EXPORT;

  const exportFile = useMutation({
    mutationFn: async (format: 'gpx' | 'kml') => {
      const blob = await api.exportRoutes({ query: { ids: [...selected.keys()].join(','), format, validatedOnly: validatedOnly ? 'true' : 'false' } });
      saveBlob(blob, `onway-routes.${format}`);
    },
  });

  const archive = useMutation({
    mutationFn: async (): Promise<Report> => {
      const result: Report = { done: [], failed: [] };
      for (const [id, name] of selected) {
        try {
          await api.archiveRoute({ params: { routeId: id } });
          result.done.push(id);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ROUTE_IN_USE') {
            const missions = (error.details as { missions?: { name: string }[] } | undefined)?.missions ?? [];
            result.failed.push({ id, name, message: t('routes.archive.inUse', { name, missions: missions.map((mission) => mission.name).join(', ') }) });
          } else {
            result.failed.push({ id, name, message: `${name}: ${errorMessage(t, error)}` });
          }
        }
      }
      return result;
    },
    onSuccess: (result) => {
      setConfirming(false);
      setReport({ ...result, action: 'archive' });
      onArchived(result.done);
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  // Eliminar es irreversible (issue #17): una llamada por ruta, como archivar, y el informe dice qué se hizo y qué no.
  const remove = useMutation({
    mutationFn: async (): Promise<Report> => {
      const result: Report = { done: [], failed: [] };
      for (const [id, name] of selected) {
        try {
          await api.deleteRoute({ params: { routeId: id } });
          result.done.push(id);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ROUTE_IN_USE') {
            const missions = (error.details as { missions?: { name: string }[] } | undefined)?.missions ?? [];
            result.failed.push({ id, name, message: t('routes.delete.inUse', { name, missions: missions.map((mission) => mission.name).join(', ') }) });
          } else if (error instanceof ApiError && error.code === 'INVALID_STATE_TRANSITION') {
            result.failed.push({ id, name, message: t('routes.delete.notArchived', { name }) });
          } else {
            result.failed.push({ id, name, message: `${name}: ${errorMessage(t, error)}` });
          }
        }
      }
      return result;
    },
    onSuccess: (result) => {
      setConfirmingDelete(false);
      setReport({ ...result, action: 'delete' });
      onDeleted(result.done);
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  return (
    <div className="selection-area">
      {count > 0 && (
        <div className="selection-bar" role="group" aria-label={t('routes.selection.count', { count })}>
          <p className="selection-count" role="status">
            {t('routes.selection.count', { count })}
          </p>
          <label className="check-row">
            <input type="checkbox" checked={validatedOnly} onChange={(event) => setValidatedOnly(event.target.checked)} />
            <span>{t('routes.selection.validatedOnly')}</span>
          </label>
          <div className="selection-buttons">
            <Menu
              label={t('common.export')}
              icon="download"
              disabled={tooMany || exportFile.isPending}
              items={(['gpx', 'kml'] as const).map((format) => ({ id: format, label: t(format === 'gpx' ? 'routes.selection.exportGpx' : 'routes.selection.exportKml'), onSelect: () => exportFile.mutate(format) }))}
            />
            {canArchive && (
              <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>
                {t('routes.selection.archive')}
              </button>
            )}
            {canDelete && (
              <button type="button" className="button button-secondary btn-eliminar-ruta" onClick={() => setConfirmingDelete(true)}>
                {t('routes.selection.delete')}
              </button>
            )}
            <button type="button" className="button button-plain" onClick={onClear}>
              {t('routes.selection.clear')}
            </button>
          </div>
          {tooMany && <p role="alert">{t('routes.selection.tooMany')}</p>}
          {exportFile.isPending && <p role="status">{t('routes.selection.exporting')}</p>}
          {exportFile.isError && <p role="alert">{errorMessage(t, exportFile.error) || t('routes.selection.exportError')}</p>}
        </div>
      )}
      {report && (
        <div className="selection-report" role="status">
          {report.done.length > 0 && <p>{t(`routes.${report.action}.done`, { count: report.done.length })}</p>}
          {report.failed.length > 0 && (
            <>
              <p>{t(`routes.${report.action}.failed`, { names: report.failed.map((failure) => failure.name).join(', ') })}</p>
              <ul>
                {report.failed.map((failure) => (
                  <li key={failure.id}>{failure.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {confirming && (
        <Dialog title={t('routes.archive.title')} description={t('routes.archive.description')} onClose={() => !archive.isPending && setConfirming(false)}>
          <ul className="dialog-list">
            {[...selected].map(([id, name]) => (
              <li key={id}>{name}</li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" className="button button-primary" data-autofocus disabled={archive.isPending} onClick={() => archive.mutate()}>
              {archive.isPending ? t('routes.archive.working') : t('routes.archive.confirm', { count })}
            </button>
            <button type="button" className="button button-secondary" disabled={archive.isPending} onClick={() => setConfirming(false)}>
              {t('routes.archive.cancel')}
            </button>
          </div>
        </Dialog>
      )}
      {confirmingDelete && (
        <Dialog
          title={t('routes.delete.title')}
          description={t(count === 1 ? 'routes.delete.descriptionOne' : 'routes.delete.description', { count })}
          onClose={() => !remove.isPending && setConfirmingDelete(false)}
        >
          <p className="dialog-note">{t('routes.delete.note')}</p>
          <ul className="dialog-list">
            {[...selected].map(([id, name]) => (
              <li key={id}>{name}</li>
            ))}
          </ul>
          <div className="dialog-actions">
            {/* El foco empieza en «Cancelar»: la acción irreversible nunca es la que se activa con un Enter distraído. */}
            <button type="button" className="button button-secondary" data-autofocus disabled={remove.isPending} onClick={() => setConfirmingDelete(false)}>
              {t('routes.delete.cancel')}
            </button>
            <button type="button" className="button button-primary" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? t('routes.delete.working') : count === 1 ? t('routes.delete.confirmOne') : t('routes.delete.confirm', { count })}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
