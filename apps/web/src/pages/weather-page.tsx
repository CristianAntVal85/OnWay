import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { usePageTitle } from '../components/use-page-title';
import { EnvironmentSection } from '../environment/environment-section';
import { missionPath, PATHS } from '../nav/navigation';
import { useCurrentUser } from '../session/session';
import { NotFoundPage } from './not-found-page';

const MISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tiempo en detalle (issue #18, RF-704, RF-705, doc 02 §3.2.1): a donde lleva el botón de la tarjeta simple. Todo lo que ya no cabe en ella
 * (ahora, próximos días, detalle por hora) y la luz y la luna. Mira el objetivo de una misión si llega `?mission=<id>`; si no, la ubicación del
 * dispositivo, que ya está en memoria (RN-26: no viaja en la dirección ni se guarda). La puede abrir cualquier rol con acceso; no tiene
 * entrada en la barra.
 */
export function WeatherPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const user = useCurrentUser();
  const [params] = useSearchParams();
  usePageTitle(t('environment.detail.title'));

  const raw = params.get('mission');
  if (raw !== null && !MISSION_ID.test(raw)) return <NotFoundPage />;

  const staff = user.role === 'admin' || user.role === 'coordinator';
  const back = raw
    ? { to: missionPath(raw), label: t('environment.detail.backToMission') }
    : staff
      ? { to: PATHS.home, label: t('environment.detail.backHome') }
      : { to: PATHS.missions, label: t('environment.detail.backMissions') };

  return (
    <div className="page-wide-flow">
      <p>
        <Link className="button-link" to={back.to}>
          {back.label}
        </Link>
      </p>
      <h1>{t('environment.detail.title')}</h1>
      <EnvironmentSection mission={raw ? { id: raw, name: null } : null} locale={locale} variant="detail" />
    </div>
  );
}
