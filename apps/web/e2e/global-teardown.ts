import { archiveLeftoverE2eRoutes, archiveLeftoverE2eTeams, closeLeftoverE2eMissions, removeOrganizationB, retireE2eAccounts } from './support/stack';

export default async function globalTeardown(): Promise<void> {
  await removeOrganizationB();
  await closeLeftoverE2eMissions();
  await archiveLeftoverE2eRoutes();
  await archiveLeftoverE2eTeams();
  await retireE2eAccounts();
}
