import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { countryName } from '../i18n/country-name';
import { EnvironmentSection, revealEnvironment } from '../environment/environment-section';
import { PATHS, ROLE_LABEL_KEYS, missionPath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';

type Item = OperationOutput<'listMissions'>['items'][number];

const SHOWN = 20;

/**
 * Inicio informativo del personal (boceto 3, RF-701): no se edita nada. Resumen de las misiones activas con lo pendiente de cada una
 * (RF-703) y, de la ubicación del dispositivo o del objetivo de la misión que se pinche, el tiempo, la luz y la luna (RF-704, RF-705, RF-708).
 */
export function HomePage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const user = useCurrentUser();
  const locale = i18n.resolvedLanguage ?? 'es';
  usePageTitle(t('home.title'));
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Misma consulta que la pestaña «Activas» de Misiones: la caché se comparte.
  const missions = useQuery({
    queryKey: ['missions', 'list', { tab: 'active', q: '', page: 1 }],
    queryFn: ({ signal }) => api.listMissions({ query: { status: 'active', page: 1, pageSize: SHOWN } }, { signal }),
  });

  // La organización de la sesión (H0): si no llega, el resto del inicio no la necesita.
  const organization = useQuery({ queryKey: ['organization'], queryFn: ({ signal }) => api.getOrganization({ signal }) });

  const items = missions.data?.items ?? [];
  const picked = items.find((item) => item.id === pickedId) ?? null;
  const canCreate = user.role === 'coordinator';

  return (
    <div className="page-wide-flow">
      <div className="page-heading">
        <h1>{t('home.title')}</h1>
        {canCreate && (
          <Link className="button button-primary" to={PATHS.createMission}>
            {t('nav.createMission')}
          </Link>
        )}
      </div>
      {user.role && (
        <p className="lead">
          {t('account.signedInAs', { name: user.displayName })} ({t(ROLE_LABEL_KEYS[user.role])})
        </p>
      )}

      {organization.data && (
        <dl className="facts-grid home-organization">
          <div>
            <dt>{t('home.organization')}</dt>
            <dd>{organization.data.name}</dd>
          </div>
          <div>
            <dt>{t('home.country')}</dt>
            <dd>{countryName(organization.data.country, locale)}</dd>
          </div>
        </dl>
      )}

      <div className="home-layout">
        <div className="home-environment">
          <EnvironmentSection mission={picked ? { id: picked.id, name: picked.name } : null} onBackToDevice={() => setPickedId(null)} locale={locale} />
        </div>

        <section className="home-missions" aria-labelledby="home-missions-title">
          <h2 id="home-missions-title">{t('home.missionsTitle')}</h2>
          {missions.isPending && <LoadingState />}
          {missions.isError && <ErrorState error={missions.error} onRetry={() => void missions.refetch()} />}
          {missions.data && items.length === 0 && (
            <EmptyState
              title={t('home.missionsEmptyTitle')}
              action={
                canCreate ? (
                  <Link className="button button-primary" to={PATHS.createMission}>
                    {t('nav.createMission')}
                  </Link>
                ) : undefined
              }
            >
              {t('home.missionsEmpty')}
            </EmptyState>
          )}
          {items.length > 0 && (
            <ul className="mission-list home-mission-list">
              {items.map((item) => (
                <ActiveMission
                  key={item.id}
                  item={item}
                  picked={item.id === picked?.id}
                  onTogglePick={() => {
                    setPickedId(item.id === picked?.id ? null : item.id);
                    revealEnvironment();
                  }}
                />
              ))}
            </ul>
          )}
          {missions.data && missions.data.total > items.length && (
            <p>
              <Link to={`${PATHS.missions}?tab=active`}>{t('home.seeAll', { total: missions.data.total })}</Link>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Lo que falta por hacer en una misión activa (RF-703): voluntarios por decidir, sin origen, sin ruta validada. */
function pendingOf(item: Item): { volunteers: number; noOrigin: boolean; noRoute: boolean } {
  return { volunteers: item.participants.pending, noOrigin: item.origins.length === 0, noRoute: item.routes.validated === 0 };
}

function ActiveMission({ item, picked, onTogglePick }: { item: Item; picked: boolean; onTogglePick: () => void }) {
  const { t } = useTranslation();
  const todo = pendingOf(item);
  const pending = [todo.volunteers > 0 && t('home.todo.volunteers', { count: todo.volunteers }), todo.noOrigin && t('home.todo.noOrigin'), todo.noRoute && t('home.todo.noRoute')].filter(Boolean);
  return (
    <li className="mission-card" data-picked={picked || undefined}>
      <h3>
        <Link to={missionPath(item.id)}>{item.name}</Link>
      </h3>
      <p className="mission-card-line">{t('home.coordinator', { name: item.coordinator?.displayName ?? t('missions.fields.noCoordinator') })}</p>
      <p className="mission-card-line">{t('missions.participantsValue', { accepted: item.participants.accepted, pending: item.participants.pending })}</p>
      <p className="mission-card-line">
        <span className="mission-card-todo">{t('home.todo.label')}</span>: {pending.length > 0 ? pending.join(' · ') : t('home.todo.none')}
      </p>
      <button type="button" className="button button-secondary mission-pick" aria-pressed={picked} aria-label={t('home.pickLabel', { name: item.name })} onClick={onTogglePick}>
        {t('home.pick')}
      </button>
    </li>
  );
}
