import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiError, type OperationInput } from '@onway/contracts/client';
import { Icon } from '../components/icon';
import { PageHeader } from '../components/page-header';
import { SectionCard } from '../components/section-card';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { useElevationLookup } from '../hooks/use-elevation-lookup';
import { errorMessage } from '../i18n/error-message';
import { MapView, type MapFocus, type MapMarker } from '../map';
import { PointInput } from '../missions/point-input';
import { toTarget, type PickedPoint } from '../missions/point';
import { PATHS, missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';

type CreateBody = OperationInput<'createMission'>['body'];

interface OriginDraft {
  key: string;
  name: string;
  note: string;
  point: PickedPoint | null;
}

const MAX_ORIGINS = 20;
const NAME_MIN = 3;
const NAME_MAX = 120;
const TARGET = 'target';

/** Crear misión (boceto 5, RF-201): lo mínimo es nombre, coordinador y objetivo; los orígenes se pueden dar ya (RF-402). */
export function CreateMissionPage() {
  const { t } = useTranslation();
  const api = useApi();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const elevationLookup = useElevationLookup();
  usePageTitle(t('createMission.title'));

  const organization = useQuery({ queryKey: ['organization'], queryFn: ({ signal }) => api.getOrganization({ signal }) });
  const coordinators = useQuery({ queryKey: ['coordinators'], queryFn: ({ signal }) => api.listCoordinators({ signal }) });

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [coordinatorId, setCoordinatorId] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState<PickedPoint | null>(null);
  const [origins, setOrigins] = useState<OriginDraft[]>([]);
  const [picking, setPicking] = useState<string | null>(TARGET);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const nextKey = useRef(1);
  const nonce = useRef(1);
  const nameField = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // Por defecto el responsable es quien crea (RF-201), si está entre los coordinadores activos.
  const coordinatorList = coordinators.data?.items;
  useEffect(() => {
    if (coordinatorId !== '' || !coordinatorList) return;
    if (coordinatorList.some((person) => person.id === user.id)) setCoordinatorId(user.id);
  }, [coordinatorList, coordinatorId, user.id]);

  const nameLength = name.trim().length;
  const nameValid = nameLength >= NAME_MIN && nameLength <= NAME_MAX;
  const originsValid = origins.every((origin) => origin.name.trim().length > 0 && origin.point !== null);
  const valid = nameValid && coordinatorId !== '' && target !== null && originsValid;

  const create = useMutation({
    mutationFn: (body: CreateBody) => api.createMission({ body }),
    onSuccess: async (mission) => {
      await queryClient.invalidateQueries({ queryKey: ['missions'] });
      navigate(missionPath(mission.id));
    },
  });

  const reveal = (point: PickedPoint) => {
    if (point.source !== 'map') setFocus({ lat: point.lat, lon: point.lon, nonce: nonce.current++ });
  };

  const changeTarget = (point: PickedPoint | null) => {
    setTarget(point);
    if (point) reveal(point);
  };

  const patchOrigin = (key: string, patch: Partial<OriginDraft>) => setOrigins((list) => list.map((origin) => (origin.key === key ? { ...origin, ...patch } : origin)));

  const addOrigin = () => {
    const key = `origin-${nextKey.current++}`;
    setOrigins((list) => [...list, { key, name: '', note: '', point: null }]);
    setPicking(key); // el nuevo origen espera el clic en el mapa
  };

  const removeOrigin = (key: string) => {
    setOrigins((list) => list.filter((origin) => origin.key !== key));
    setPicking((current) => (current === key ? null : current));
  };

  const onPick = (point: { lat: number; lon: number }) => {
    const picked: PickedPoint = { lat: point.lat, lon: point.lon, source: 'map' };
    if (picking === TARGET) setTarget(picked);
    else if (picking) patchOrigin(picking, { point: picked });
  };

  const markers = useMemo<MapMarker[]>(
    () => [
      ...(target ? [{ id: TARGET, kind: 'target' as const, lat: target.lat, lon: target.lon }] : []),
      ...origins.flatMap((origin, index) =>
        origin.point
          ? [{ id: origin.key, kind: 'origin' as const, lat: origin.point.lat, lon: origin.point.lon, label: origin.name.trim() || t('createMission.originTitle', { number: index + 1 }) }]
          : [],
      ),
    ],
    [target, origins, t],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    if (!valid || !target) {
      setShowErrors(true);
      // El foco va al primer dato que falta, para que el teclado y el lector de pantalla lo encuentren.
      const firstInvalid = !nameValid ? nameField.current : form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-missing="true"] input, [data-missing="true"] button');
      firstInvalid?.focus();
      return;
    }
    create.mutate({
      name: name.trim(),
      coordinatorId,
      target: toTarget(target),
      ...(description.trim() ? { description: description.trim() } : {}),
      teamIds: [],
      rescuerIds: [],
      routes: [],
      origins: origins.map((origin) => ({ name: origin.name.trim(), ...(origin.note.trim() ? { note: origin.note.trim() } : {}), lat: origin.point!.lat, lon: origin.point!.lon })),
    });
  };

  const failure = create.error;
  const duplicateName = failure instanceof ApiError && failure.code === 'DUPLICATE_NAME';
  const alertText = !failure || duplicateName ? null : failure instanceof ApiError && failure.code === 'OUTSIDE_COVERAGE' ? t('createMission.outsideCoverage') : errorMessage(t, failure);
  const nameError = duplicateName ? t('createMission.duplicateName') : (nameTouched || showErrors) && !nameValid ? t('createMission.nameInvalid') : null;

  return (
    <div className="page-wide">
      <div className="split-layout">
        <div className="split-form">
          <PageHeader icon="pin" title={t('createMission.title')} />
          <form ref={form} onSubmit={onSubmit} noValidate>
            <SectionCard icon="document" title={t('createMission.required')}>
              <div className="field">
                <div className="field-label">
                  <label htmlFor="mission-name">{t('createMission.name')}</label>
                  <span className="field-required" aria-hidden="true">
                    *
                  </span>
                </div>
                <input
                  id="mission-name"
                  ref={nameField}
                  type="text"
                  value={name}
                  autoComplete="off"
                  maxLength={NAME_MAX + 40}
                  aria-required="true"
                  aria-invalid={nameError !== null}
                  aria-describedby={nameError ? 'mission-name-error' : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (duplicateName) create.reset();
                  }}
                  onBlur={() => setNameTouched(true)}
                />
                {nameError && (
                  <p id="mission-name-error" className="field-error" role="alert">
                    {nameError}
                  </p>
                )}
              </div>

              <div className="field">
                <div className="field-label">
                  <label htmlFor="mission-coordinator">{t('createMission.coordinator')}</label>
                  <span className="field-required" aria-hidden="true">
                    *
                  </span>
                </div>
                {coordinators.isPending && <LoadingState />}
                {coordinators.isError && <ErrorState error={coordinators.error} onRetry={() => void coordinators.refetch()} />}
                {coordinatorList && coordinatorList.length === 0 && <EmptyState title={t('createMission.coordinator')}>{t('createMission.coordinatorsEmpty')}</EmptyState>}
                {coordinatorList && coordinatorList.length > 0 && (
                  <select
                    id="mission-coordinator"
                    aria-required="true"
                    value={coordinatorId}
                    onChange={(event) => setCoordinatorId(event.target.value)}
                    aria-invalid={showErrors && coordinatorId === ''}
                  >
                    <option value="" disabled>
                      {t('createMission.coordinator')}
                    </option>
                    {coordinatorList.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </SectionCard>

            <SectionCard icon="target" title={t('createMission.objective')}>
              <div data-missing={showErrors && !target ? 'true' : undefined}>
                <PointInput
                  id="target"
                  value={target}
                  onChange={changeTarget}
                  picking={picking === TARGET}
                  onPicking={(on) => setPicking(on ? TARGET : picking === TARGET ? null : picking)}
                  organizationCountry={organization.data?.country}
                  elevationLookup={elevationLookup}
                  error={showErrors && !target ? t('createMission.objectiveRequired') : null}
                />
              </div>
            </SectionCard>

            <SectionCard icon="info" title={t('createMission.additional')}>
              <div className="field">
                <label htmlFor="mission-description">{t('createMission.description')}</label>
                <textarea id="mission-description" rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
            </SectionCard>

            <SectionCard
              icon="pin"
              title={t('createMission.origins')}
              actions={
                <button type="button" className="button button-secondary" aria-disabled={origins.length >= MAX_ORIGINS} onClick={() => origins.length < MAX_ORIGINS && addOrigin()}>
                  <Icon name="plus" />
                  <span>{t('createMission.addOrigin')}</span>
                </button>
              }
            >
              {origins.map((origin, index) => (
                <fieldset key={origin.key} className="point-group origin-group">
                  <legend>{t('createMission.originTitle', { number: index + 1 })}</legend>
                  <div className="field">
                    <label htmlFor={`${origin.key}-name`}>{t('createMission.originName')}</label>
                    <input
                      id={`${origin.key}-name`}
                      type="text"
                      maxLength={120}
                      value={origin.name}
                      autoComplete="off"
                      aria-invalid={showErrors && origin.name.trim() === ''}
                      aria-describedby={showErrors && origin.name.trim() === '' ? `${origin.key}-name-error` : undefined}
                      onChange={(event) => patchOrigin(origin.key, { name: event.target.value })}
                    />
                    {showErrors && origin.name.trim() === '' && (
                      <p id={`${origin.key}-name-error`} className="field-error" role="alert">
                        {t('createMission.originNameRequired')}
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor={`${origin.key}-note`}>{t('createMission.originNote')}</label>
                    <input id={`${origin.key}-note`} type="text" maxLength={1000} value={origin.note} autoComplete="off" onChange={(event) => patchOrigin(origin.key, { note: event.target.value })} />
                  </div>
                  <div data-missing={showErrors && !origin.point ? 'true' : undefined}>
                    <PointInput
                      id={origin.key}
                      value={origin.point}
                      onChange={(point) => {
                        patchOrigin(origin.key, { point });
                        if (point) reveal(point);
                      }}
                      picking={picking === origin.key}
                      onPicking={(on) => setPicking(on ? origin.key : picking === origin.key ? null : picking)}
                      organizationCountry={organization.data?.country}
                      elevationLookup={elevationLookup}
                      error={showErrors && !origin.point ? t('createMission.originPointRequired') : null}
                    />
                  </div>
                  <button type="button" className="button button-plain origin-remove" onClick={() => removeOrigin(origin.key)}>
                    <Icon name="trash" />
                    <span>{t('createMission.removeOrigin', { number: index + 1 })}</span>
                  </button>
                </fieldset>
              ))}
              {origins.length === 0 && <p className="form-note">{t('createMission.originsEmpty')}</p>}
              {origins.length >= MAX_ORIGINS && <p className="form-note">{t('createMission.originsLimit')}</p>}
            </SectionCard>

            <div className="action-bar">
              <div role="alert" className="action-bar-alert">
                {alertText && <p>{alertText}</p>}
                {!alertText && showErrors && !valid && <p>{t('createMission.formErrors')}</p>}
              </div>
              <div className="action-bar-buttons">
                {!valid && (
                  <p id="create-incomplete" className="action-bar-hint">
                    {t('createMission.incomplete')}
                  </p>
                )}
                <button type="button" className="button button-secondary" onClick={() => navigate(PATHS.missions)}>
                  {t('createMission.cancel')}
                </button>
                <button type="submit" className="button button-primary" aria-disabled={!valid || create.isPending} aria-describedby={valid ? undefined : 'create-incomplete'}>
                  {create.isPending ? t('createMission.submitting') : t('createMission.submit')}
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="split-map">
          <MapView label={t('createMission.mapRegion')} markers={markers} focus={focus} elevationLookup={elevationLookup} picking={picking !== null} {...(picking !== null ? { onPick } : {})} />
        </div>
      </div>
    </div>
  );
}
