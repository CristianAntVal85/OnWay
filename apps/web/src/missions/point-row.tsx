import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { useApi } from '../session/api-context';
import { missionChangedMeanwhile, writeFailureMessage } from './errors';
import { formatMeters } from './format';

type MissionPoint = OperationOutput<'getMission'>['points'][number];

interface Props {
  missionId: string;
  point: MissionPoint;
  locale: string;
  /** Solo con `actions.edit`: sin él la fila es de lectura, sin ningún control. */
  canEdit: boolean;
  confirming: boolean;
  onEdit: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemoved: (name: string) => void;
}

/** Un punto de la misión con sus datos y, si se puede escribir, Editar y Borrar (con confirmación en la misma fila). */
export function PointRow({ missionId, point, locale, canEdit, confirming, onEdit, onAskRemove, onCancelRemove, onRemoved }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const cancel = useRef<HTMLButtonElement>(null);

  // Al pedir confirmación, el foco va a la opción segura («No borrar»).
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  const remove = useMutation({
    mutationFn: () => api.deleteMissionPoint({ params: { missionId, pointId: point.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['missions'] });
      onRemoved(point.name);
    },
    onError: (error) => {
      if (missionChangedMeanwhile(error)) void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });

  return (
    <li className="point-row" data-kind={point.kind}>
      <div className="point-row-main">
        <p className="point-row-name">{point.name}</p>
        {point.note && <p className="point-row-note">{point.note}</p>}
        <p className="point-row-position">
          {formatCoordinate(point, 'decimal')} ·{' '}
          {point.elevationM === null ? t('missionDetail.points.noAltitude') : t('missionDetail.points.altitude', { meters: formatMeters(point.elevationM, locale) })}
        </p>
      </div>
      {canEdit && !confirming && (
        <div className="point-row-actions">
          <button id={`point-edit-${point.id}`} type="button" className="button button-secondary" aria-label={t('missionDetail.points.edit', { name: point.name })} onClick={onEdit}>
            {t('missionDetail.points.editShort')}
          </button>
          <button type="button" className="button button-secondary" aria-label={t('missionDetail.points.remove', { name: point.name })} onClick={onAskRemove}>
            {t('missionDetail.points.removeShort')}
          </button>
        </div>
      )}
      {canEdit && confirming && (
        <div className="point-row-confirm" role="group" aria-label={t('missionDetail.points.removeConfirm', { name: point.name })}>
          <p>{t('missionDetail.points.removeConfirm', { name: point.name })}</p>
          <div className="point-row-actions">
            <button type="button" className="button button-primary" aria-disabled={remove.isPending} onClick={() => !remove.isPending && remove.mutate()}>
              {remove.isPending ? t('missionDetail.points.removing') : t('missionDetail.points.removeYes')}
            </button>
            <button ref={cancel} type="button" className="button button-secondary" onClick={onCancelRemove}>
              {t('missionDetail.points.removeNo')}
            </button>
          </div>
          {remove.isError && (
            <p className="field-error" role="alert">
              {writeFailureMessage(t, remove.error)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
