import { archiveLeftoverE2eRoutes, closeLeftoverE2eMissions, removeOrganizationB, retireE2eAccounts } from './support/stack';

export default async function globalTeardown(): Promise<void> {
  await removeOrganizationB();
  await closeLeftoverE2eMissions();
  await archiveLeftoverE2eRoutes();
  await retireE2eAccounts();
}
