import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { errorMessage } from '../i18n/error-message';
import { useApi } from '../session/api-context';
import { saveBlob } from './download';

/** Lo más que admite `exportRoutes` de una vez. */
export const MAX_EXPORT = 50;

interface Props {
  selected: ReadonlyMap<string, string>;
  canArchive: boolean;
  onClear: () => void;
  onArchived: (ids: string[]) => void;
}

interface ArchiveReport {
  done: string[];
  failed: { name: string; message: string }[];
}

/** Acciones sobre la selección, que se conserva al cambiar de página: exportar (GPX o KML) y, quien puede escribir, archivar. */
export function SelectionBar({ selected, canArchive, onClear, onArchived }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<ArchiveReport | null>(null);
  const count = selected.size;
  const tooMany = count > MAX_EXPORT;

  const exportFile = useMutation({
    mutationFn: async (format: 'gpx' | 'kml') => {
      const blob = await api.exportRoutes({ query: { ids: [...selected.keys()].join(','), format, validatedOnly: validatedOnly ? 'true' : 'false' } });
      saveBlob(blob, `onway-routes.${format}`);
    },
  });

  const archive = useMutation({
    mutationFn: async (): Promise<ArchiveReport> => {
      const result: ArchiveReport = { done: [], failed: [] };
      for (const [id, name] of selected) {
        try {
          await api.archiveRoute({ params: { routeId: id } });
          result.done.push(id);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ROUTE_IN_USE') {
            const missions = (error.details as { missions?: { name: string }[] } | undefined)?.missions ?? [];
            result.failed.push({ name, message: t('routes.archive.inUse', { name, missions: missions.map((mission) => mission.name).join(', ') }) });
          } else {
            result.failed.push({ name, message: `${name}: ${errorMessage(t, error)}` });
          }
        }
      }
      return result;
    },
    onSuccess: (result) => {
      setConfirming(false);
      setReport(result);
      onArchived(result.done);
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  return (
    <div className="selection-area">
      {count === 0 && report === null && <p className="selection-hint">{t('routes.selection.hint')}</p>}
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
            {(['gpx', 'kml'] as const).map((format) => (
              <button key={format} type="button" className="button button-secondary" disabled={tooMany || exportFile.isPending} onClick={() => exportFile.mutate(format)}>
                {t(format === 'gpx' ? 'routes.selection.exportGpx' : 'routes.selection.exportKml')}
              </button>
            ))}
            {canArchive && (
              <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>
                {t('routes.selection.archive')}
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={onClear}>
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
          {report.done.length > 0 && <p>{t('routes.archive.done', { count: report.done.length })}</p>}
          {report.failed.length > 0 && (
            <>
              <p>{t('routes.archive.failed', { names: report.failed.map((failure) => failure.name).join(', ') })}</p>
              <ul>
                {report.failed.map((failure) => (
                  <li key={failure.name}>{failure.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {confirming && (
        <Dialog title={t('routes.archive.title')} description={t('routes.archive.description')} onClose={() => !archive.isPending && setConfirming(false)}>
          <ul className="dialog-list">
            {[...selected.values()].map((name) => (
              <li key={name}>{name}</li>
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
    </div>
  );
}
