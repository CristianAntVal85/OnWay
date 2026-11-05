import { useEffect, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import type { TFunction } from 'i18next';
import { Dialog } from '../components/dialog';
import { ErrorState, LoadingState } from '../components/states';
import { errorMessage } from '../i18n/error-message';
import { formatKm } from '../library/format';
import { PATHS } from '../nav/navigation';
import { useApi } from '../session/api-context';

type Item = OperationOutput<'listRoutes'>['items'][number];
type Detail = OperationOutput<'getRoute'>;

/** Lo más que admite `addMissionRoutes` de una vez (doc 06). */
export const MAX_ADD = 20;
const PAGE_SIZE = 10;

type VersionFilter = '' | 'draft' | 'validated';
interface Choice {
  versionId?: string;
  originPointId: string;
  note: string;
}

interface Props {
  missionId: string;
  /** Los orígenes de la misión, para ofrecer uno a cada ruta y para saber si se puede generar (RN-08). */
  origins: readonly { id: string; name: string }[];
  /** Rutas que la misión ya tiene (INV-13): se enseñan marcadas y no se pueden elegir. */
  inMission: ReadonlySet<string>;
  onClose: () => void;
  onAdded: (count: number) => void;
}

/** Por defecto la misión fija la última versión validada y, si no hay ninguna, la última (D-H4-01). Las versiones vienen de la más nueva a la más antigua. */
function defaultVersion(detail: Detail): string | undefined {
  return (detail.versions.find((version) => version.status === 'validated') ?? detail.versions[0])?.id;
}

/** El texto del fallo al añadir: cada código que el servidor puede dar aquí tiene el suyo, y el lote es atómico (no se añade ninguna). */
function addFailure(t: TFunction, error: unknown, names: ReadonlyMap<string, string>): string {
  if (error instanceof ApiError) {
    if (error.code === 'ROUTE_ALREADY_IN_MISSION') {
      const name = names.get(String(error.details?.['routeId'] ?? ''));
      return name ? t('missionRoutes.add.errors.alreadyIn', { name }) : t('missionRoutes.add.errors.alreadyInUnknown');
    }
    if (error.code === 'INVALID_STATE_TRANSITION') return t('missionRoutes.add.errors.archived');
    if (error.code === 'MISSION_CLOSED') return t('missionDetail.closedMeanwhile');
    if (error.code === 'NOT_FOUND') return t('missionRoutes.add.errors.notFound');
  }
  return errorMessage(t, error);
}

/**
 * «Añadir ruta» (boceto 11, RF-513, doc 02 §4.3): elegir de la biblioteca hasta 20 rutas, decidir la versión que fija la misión (la última validada
 * por defecto), su origen y una nota; o ir a generar o importar una nueva para esta misión. El servidor decide: la versión, el origen y las rutas se
 * comprueban allí y el lote es atómico. Nada de geometría aquí.
 */
export function AddRouteDialog({ missionId, origins, inMission, onClose, onAdded }: Props) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage ?? 'es';
  const [step, setStep] = useState<'choose' | 'details'>('choose');
  const [draftQuery, setDraftQuery] = useState('');
  const [q, setQ] = useState('');
  const [versionStatus, setVersionStatus] = useState<VersionFilter>('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<ReadonlyMap<string, Item>>(new Map());
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const title = useRef<HTMLHeadingElement>(null);

  // Una ruta que otra persona añadió mientras tanto deja de poder elegirse.
  const chosen = [...picked.values()].filter((item) => !inMission.has(item.id));

  const list = useQuery({
    queryKey: ['routes', 'add-to-mission', { q, versionStatus, page }],
    queryFn: ({ signal }) => api.listRoutes({ query: { status: 'active', page, pageSize: PAGE_SIZE, ...(q ? { q } : {}), ...(versionStatus ? { versionStatus } : {}) } }, { signal }),
    placeholderData: keepPreviousData,
    enabled: step === 'choose',
  });

  // Las versiones de las rutas elegidas se leen al pasar al segundo paso (comparte la caché con el detalle de la ruta).
  const details = useQueries({
    queries: (step === 'details' ? chosen : []).map((item) => ({
      queryKey: ['route', item.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.getRoute({ params: { routeId: item.id } }, { signal }),
    })),
  });

  const add = useMutation({
    mutationFn: () => {
      const items = chosen.map((item, index) => {
        const choice = choices[item.id];
        const detail = details[index]?.data;
        const versionId = choice?.versionId ?? (detail ? defaultVersion(detail) : undefined);
        const note = choice?.note.trim();
        return { routeId: item.id, ...(versionId ? { versionId } : {}), ...(choice?.originPointId ? { originPointId: choice.originPointId } : {}), ...(note ? { note } : {}) };
      });
      return api.addMissionRoutes({ params: { missionId }, body: { items } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['missions'] });
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      onAdded(result.items.length || chosen.length);
      onClose();
    },
    onError: (error) => {
      // Si ya estaba, o la misión cambió, se vuelve a leer para que la lista lo refleje.
      if (error instanceof ApiError && ['ROUTE_ALREADY_IN_MISSION', 'MISSION_CLOSED', 'NOT_FOUND', 'INVALID_STATE_TRANSITION'].includes(error.code))
        void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });

  // Al cambiar de paso, el foco va al título del paso (no se pierde en un botón que ya no existe).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    title.current?.focus();
  }, [step]);

  const toggle = (item: Item) =>
    setPicked((current) => {
      const next = new Map(current);
      if (!next.delete(item.id)) next.set(item.id, item);
      return next;
    });
  const setChoice = (id: string, changes: Partial<Choice>) => setChoices((current) => ({ ...current, [id]: { originPointId: '', note: '', ...current[id], ...changes } }));
  const search = (event: FormEvent) => {
    event.preventDefault();
    setQ(draftQuery.trim());
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const full = chosen.length >= MAX_ADD;
  const noneChosen = chosen.length === 0;
  const readingVersions = details.some((result) => result.isPending);
  const versionsFailed = details.some((result) => result.isError);
  const busy = add.isPending;
  // Los nombres salen de todo lo elegido, también de lo que acaba de pasar a «ya está en la misión» y deja de contar para el lote.
  const names = new Map([...picked.values()].map((item) => [item.id, item.name]));

  return (
    <Dialog title={t('missionRoutes.add.title')} description={<p>{t('missionRoutes.add.description')}</p>} onClose={() => !busy && onClose()}>
      <div className="add-route">
        {step === 'choose' && (
          <>
            <section aria-labelledby="add-library-title">
              <h3 id="add-library-title" ref={title} tabIndex={-1}>
                {t('missionRoutes.add.libraryTitle')}
              </h3>
              <form role="search" className="add-route-search" onSubmit={search}>
                <div className="field">
                  <label htmlFor="add-route-search">{t('routes.searchLabel')}</label>
                  <div className="field-row">
                    <input
                      id="add-route-search"
                      data-autofocus
                      type="search"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={120}
                      value={draftQuery}
                      onChange={(event) => setDraftQuery(event.target.value)}
                    />
                    <button type="submit" className="button button-secondary">
                      {t('routes.searchSubmit')}
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="add-route-version">{t('missionRoutes.add.versionFilter')}</label>
                  <select
                    id="add-route-version"
                    value={versionStatus}
                    onChange={(event) => {
                      setVersionStatus(event.target.value as VersionFilter);
                      setPage(1);
                    }}
                  >
                    <option value="">{t('routes.filters.versionAny')}</option>
                    <option value="draft">{t('routes.filters.versionDraft')}</option>
                    <option value="validated">{t('routes.filters.versionValidated')}</option>
                  </select>
                </div>
              </form>

              {list.isPending && <LoadingState />}
              {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
              {list.isSuccess && list.data.items.length === 0 && <p>{t('missionRoutes.add.empty')}</p>}
              {list.isSuccess && list.data.items.length > 0 && (
                <ul className="add-route-list" aria-label={t('missionRoutes.add.listLabel')}>
                  {list.data.items.map((item) => {
                    const already = inMission.has(item.id);
                    const checked = picked.has(item.id) && !already;
                    return (
                      <li key={item.id} className="add-route-item" data-already={already || undefined}>
                        <input
                          id={`add-pick-${item.id}`}
                          type="checkbox"
                          checked={checked}
                          disabled={already || (full && !checked)}
                          aria-label={t('missionRoutes.add.pick', { name: item.name })}
                          onChange={() => toggle(item)}
                        />
                        <label htmlFor={`add-pick-${item.id}`}>
                          <span className="add-route-name">{item.name}</span>
                          <span className="add-route-meta">{t('missionRoutes.add.latest', { status: t(`routeDetail.versions.${item.latestVersion.status}`), number: item.latestVersion.number })}</span>
                          <span className="add-route-meta">{t('units.km', { value: formatKm(item.latestVersion.metrics.distanceM, locale) })}</span>
                          {already && <span className="status-badge">{t('missionRoutes.add.inMission')}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {list.isSuccess && pages > 1 && (
                <nav className="add-route-pager" aria-label={t('missionRoutes.add.listLabel')}>
                  <button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('missionRoutes.add.previous')}
                  </button>
                  <span>{t('missionRoutes.add.page', { page, pages })}</span>
                  <button type="button" className="button button-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    {t('missionRoutes.add.next')}
                  </button>
                </nav>
              )}
              <p role="status">{t('missionRoutes.add.selected', { count: chosen.length, max: MAX_ADD })}</p>
              <p className="field-help">{t('missionRoutes.add.limit', { max: MAX_ADD })}</p>
            </section>

            <section aria-labelledby="add-other-title" className="add-route-other">
              <h3 id="add-other-title">{t('missionRoutes.add.other.title')}</h3>
              {origins.length > 0 ? (
                <p>
                  <Link className="button button-secondary" to={`${PATHS.generateRoutes}?mission=${missionId}`}>
                    {t('missionRoutes.add.other.generate')}
                  </Link>{' '}
                  <span className="field-help">{t('missionRoutes.add.other.generateHint')}</span>
                </p>
              ) : (
                <p className="field-help">{t('missionRoutes.add.other.generateNoOrigin')}</p>
              )}
              <p>
                <Link className="button button-secondary" to={`${PATHS.routeImport}?mission=${missionId}`}>
                  {t('missionRoutes.add.other.import')}
                </Link>{' '}
                <span className="field-help">{t('missionRoutes.add.other.importHint')}</span>
              </p>
            </section>

            <div className="dialog-actions">
              <button type="button" className="button button-primary" aria-disabled={noneChosen || undefined} onClick={() => !noneChosen && setStep('details')}>
                {t('missionRoutes.add.continue')}
              </button>
              <button type="button" className="button button-secondary" onClick={onClose}>
                {t('missionRoutes.add.cancel')}
              </button>
            </div>
          </>
        )}

        {step === 'details' && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !readingVersions && !versionsFailed && !noneChosen) add.mutate();
            }}
            noValidate
          >
            <h3 ref={title} tabIndex={-1}>
              {t('missionRoutes.add.details.title')}
            </h3>
            <p className="field-help">{t('missionRoutes.add.details.help')}</p>
            {readingVersions && <LoadingState label={t('missionRoutes.add.details.loadingVersions')} />}
            {versionsFailed && (
              <p className="field-error" role="alert">
                {errorMessage(t, details.find((result) => result.isError)?.error)}
              </p>
            )}
            {chosen.map((item, index) => {
              const detail = details[index]?.data;
              const choice = choices[item.id];
              const versionId = choice?.versionId ?? (detail ? defaultVersion(detail) : undefined);
              const selected = detail?.versions.find((version) => version.id === versionId);
              return (
                <fieldset key={item.id} className="add-route-details">
                  <legend>{item.name}</legend>
                  {detail && (
                    <div className="field">
                      <label htmlFor={`add-version-${item.id}`}>{t('missionRoutes.add.details.version')}</label>
                      <select id={`add-version-${item.id}`} value={versionId} onChange={(event) => setChoice(item.id, { versionId: event.target.value })}>
                        {detail.versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            {t('missionRoutes.add.details.versionOption', { number: version.number, status: t(`routeDetail.versions.${version.status}`) })}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selected?.status === 'draft' && <p className="mission-route-notice">{t('missionRoutes.add.details.draftWarning')}</p>}
                  <div className="field">
                    <label htmlFor={`add-origin-${item.id}`}>{t('missionRoutes.add.details.origin')}</label>
                    <select id={`add-origin-${item.id}`} value={choice?.originPointId ?? ''} onChange={(event) => setChoice(item.id, { originPointId: event.target.value })}>
                      <option value="">{t('missionRoutes.add.details.noOrigin')}</option>
                      {origins.map((origin) => (
                        <option key={origin.id} value={origin.id}>
                          {origin.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`add-note-${item.id}`}>{t('missionRoutes.add.details.note')}</label>
                    <textarea id={`add-note-${item.id}`} rows={2} maxLength={1000} value={choice?.note ?? ''} onChange={(event) => setChoice(item.id, { note: event.target.value })} />
                  </div>
                </fieldset>
              );
            })}
            <div className="dialog-actions">
              <button type="submit" className="button button-primary" aria-disabled={busy || readingVersions || versionsFailed || noneChosen || undefined}>
                {busy ? t('missionRoutes.add.submitting') : t('missionRoutes.add.submit', { count: chosen.length })}
              </button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => setStep('choose')}>
                {t('missionRoutes.add.back')}
              </button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>
                {t('missionRoutes.add.cancel')}
              </button>
            </div>
            {add.isError && (
              <p className="field-error" role="alert">
                {addFailure(t, add.error, names)}
              </p>
            )}
          </form>
        )}
      </div>
    </Dialog>
  );
}
