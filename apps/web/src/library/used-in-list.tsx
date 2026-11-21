import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { writeFailureMessage } from '../missions/errors';
import { missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';

type Use = OperationOutput<'getRoute'>['usedIn'][number];

/**
 * «Usada en» del detalle de una ruta (RF-512, D-N6): cada misión con su estado y la versión que fija. Quien escribe puede quitar la ruta
 * de una misión en planificación o activa (`removeMissionRoute`), con confirmación en la fila y el foco en «No quitar»; una misión cerrada
 * es de solo lectura (RN-09, INV-11) y no tiene botón. Quitarla deja la ruta en la biblioteca, lista para archivarse (INV-07).
 */
export function UsedInList({ routeId, usedIn, canWrite }: { routeId: string; usedIn: Use[]; canWrite: boolean }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Tras quitar una ruta su fila desaparece: el foco pasa al bloque, que lee el resultado, en vez de caer al cuerpo de la página.
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done) block.current?.focus();
  }, [done]);

  return (
    <div ref={block} tabIndex={-1} className="used-in">
      <p className="visually-hidden" role="status">
        {done}
      </p>
      {usedIn.length === 0 ? (
        <p className="form-note">{t('routeDetail.relations.notUsed')}</p>
      ) : (
        <ul className="plain-list used-in-list">
          {usedIn.map((use) => (
            <UsedInItem
              key={use.missionRouteId}
              routeId={routeId}
              use={use}
              canRemove={canWrite && use.missionStatus !== 'closed'}
              confirming={confirming === use.missionRouteId}
              onConfirm={() => {
                setDone(null);
                setConfirming(use.missionRouteId);
              }}
              onCancel={() => setConfirming(null)}
              onRemoved={() => {
                setConfirming(null);
                setDone(t('routeDetail.relations.removeDone', { mission: use.missionName }));
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ItemProps {
  routeId: string;
  use: Use;
  canRemove: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRemoved: () => void;
}

function UsedInItem({ routeId, use, canRemove, confirming, onConfirm, onCancel, onRemoved }: ItemProps) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const safe = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const removed = useRef(false);

  // Al abrir la confirmación, el foco va a «No quitar»; al cancelarla, vuelve al botón que la abrió.
  useEffect(() => {
    if (confirming) safe.current?.focus();
    else if (wasConfirming.current && !removed.current) trigger.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const remove = useMutation({
    mutationFn: () => api.removeMissionRoute({ params: { missionId: use.missionId, missionRouteId: use.missionRouteId } }),
    onSuccess: async () => {
      removed.current = true;
      await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
      void queryClient.invalidateQueries({ queryKey: ['missions'] });
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      onRemoved();
    },
    onError: () => {
      // Si la misión se cerró mientras tanto, la lista vuelve a leerse y el botón desaparece.
      void queryClient.invalidateQueries({ queryKey: ['route', routeId] });
    },
  });

  return (
    <li className="used-in-item">
      <span>
        <Link to={missionPath(use.missionId)}>{use.missionName}</Link> {t('routeDetail.relations.usedInRow', { status: t(`missions.status.${use.missionStatus}`), number: use.pinnedVersionNumber })}
        {use.missionStatus === 'closed' && ` · ${t('routeDetail.relations.readOnly')}`}
      </span>
      {canRemove && !confirming && (
        <button ref={trigger} type="button" className="button button-secondary" aria-label={t('routeDetail.relations.removeFor', { mission: use.missionName })} onClick={onConfirm}>
          {t('routeDetail.relations.remove')}
        </button>
      )}
      {canRemove && confirming && (
        <span className="point-row-confirm" role="group" aria-labelledby={`remove-confirm-${use.missionRouteId}`}>
          <span id={`remove-confirm-${use.missionRouteId}`}>{t('routeDetail.relations.removeConfirm', { mission: use.missionName })}</span>
          <span className="point-row-actions">
            <button type="button" className="button button-primary" aria-disabled={remove.isPending} onClick={() => !remove.isPending && remove.mutate()}>
              {remove.isPending ? t('routeDetail.relations.removeBusy') : t('routeDetail.relations.removeYes')}
            </button>
            <button ref={safe} type="button" className="button button-secondary" onClick={onCancel}>
              {t('routeDetail.relations.removeNo')}
            </button>
          </span>
        </span>
      )}
      {remove.isError && (
        <span className="field-error" role="alert">
          {writeFailureMessage(t, remove.error)}
        </span>
      )}
    </li>
  );
}
