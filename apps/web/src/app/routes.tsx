import { Navigate, Route, Routes } from 'react-router';
import { RedirectToLanding, RequireActive, RequireSession, RoleGate } from '../components/guards';
import { Shell } from '../components/shell';
import { SkipLink } from '../components/skip-link';
import { PATHS } from '../nav/navigation';
import { AccountPage } from '../pages/account-page';
import { AdminPage } from '../pages/admin-page';
import { CreateMissionPage } from '../pages/create-mission-page';
import { ForgotPasswordPage } from '../pages/forgot-password-page';
import { HomePage } from '../pages/home-page';
import { LaterPage } from '../pages/later-page';
import { MissionDetailPage } from '../pages/mission-detail-page';
import { MissionsPage } from '../pages/missions-page';
import { LoginPage } from '../pages/login-page';
import { NotFoundPage } from '../pages/not-found-page';
import { ProfilePage } from '../pages/profile-page';
import { GenerateRoutesPage } from '../pages/generate-routes-page';
import { ImportRoutePage } from '../pages/import-route-page';
import { RegisterPage } from '../pages/register-page';
import { ResetPasswordPage } from '../pages/reset-password-page';
import { RouteDetailPage } from '../pages/route-detail-page';
import { RouteContinuePage } from '../pages/route-continue-page';
import { RouteEditorPage } from '../pages/route-editor-page';
import { RoutesPage } from '../pages/routes-page';
import { WaitingPage } from '../pages/waiting-page';
import { WeatherPage } from '../pages/weather-page';

/** Rutas de la web. Cada ruta de la barra pasa por `RoleGate`; el servidor decide igualmente (RF-103). */
export function AppRoutes() {
  return (
    <>
      <SkipLink />
      <Routes>
        <Route path={PATHS.login} element={<LoginPage />} />
        <Route path={PATHS.register} element={<RegisterPage />} />
        <Route path={PATHS.forgotPassword} element={<ForgotPasswordPage />} />
        <Route path={PATHS.resetPassword} element={<ResetPasswordPage />} />
        <Route element={<RequireSession />}>
          <Route path={PATHS.waiting} element={<WaitingPage />} />
          <Route element={<RequireActive />}>
            <Route element={<Shell />}>
              <Route index element={<RedirectToLanding />} />
              <Route
                path={PATHS.home}
                element={
                  <RoleGate route="home">
                    <HomePage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.missions}
                element={
                  <RoleGate route="missions">
                    <MissionsPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.createMission}
                element={
                  <RoleGate route="createMission">
                    <CreateMissionPage />
                  </RoleGate>
                }
              />
              <Route
                path={`${PATHS.missions}/:missionId`}
                element={
                  <RoleGate route="missions">
                    <MissionDetailPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.routes}
                element={
                  <RoleGate route="routes">
                    <RoutesPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.routeImport}
                element={
                  <RoleGate route="createRoute">
                    <ImportRoutePage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.generateRoutes}
                element={
                  <RoleGate route="generateRoutes">
                    <GenerateRoutesPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.createRoute}
                element={
                  <RoleGate route="createRoute">
                    <RouteEditorPage mode="draw" />
                  </RoleGate>
                }
              />
              <Route
                path={`${PATHS.routes}/:routeId/edit`}
                element={
                  <RoleGate route="createRoute">
                    <RouteEditorPage mode="edit" />
                  </RoleGate>
                }
              />
              <Route
                path={`${PATHS.routes}/:routeId/continue`}
                element={
                  <RoleGate route="createRoute">
                    <RouteContinuePage />
                  </RoleGate>
                }
              />
              <Route
                path={`${PATHS.routes}/:routeId`}
                element={
                  <RoleGate route="routes">
                    <RouteDetailPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.teams}
                element={
                  <RoleGate route="teams">
                    <LaterPage section="nav.teams" />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.admin}
                element={
                  <RoleGate route="admin">
                    <AdminPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.profile}
                element={
                  <RoleGate route="profile">
                    <ProfilePage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.account}
                element={
                  <RoleGate route="account">
                    <AccountPage />
                  </RoleGate>
                }
              />
              <Route
                path={PATHS.weather}
                element={
                  <RoleGate route="weather">
                    <WeatherPage />
                  </RoleGate>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to={PATHS.login} replace />} />
      </Routes>
    </>
  );
}
