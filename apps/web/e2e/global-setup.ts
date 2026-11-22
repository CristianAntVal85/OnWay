import { archiveLeftoverE2eRoutes, archiveLeftoverE2eTeams, closeLeftoverE2eMissions, createOrganizationB, restartApi, retireE2eAccounts } from './support/stack';

// La organización B existe solo mientras dura la ejecución (D-H0-18): nada de ella queda en la demostración.
export default async function globalSetup(): Promise<void> {
  // Vacía los contadores en memoria del limitador de los endpoints públicos (la demostración de H5-acceso gasta una parte de cada uno).
  await restartApi(`${process.env.E2E_BASE_URL ?? 'http://localhost:8080'}/api/v1/health`);
  await closeLeftoverE2eMissions(); // restos de una ejecución interrumpida
  await archiveLeftoverE2eRoutes();
  await archiveLeftoverE2eTeams();
  await retireE2eAccounts();
  await createOrganizationB();
}
