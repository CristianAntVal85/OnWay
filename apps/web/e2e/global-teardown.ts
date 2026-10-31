import { archiveLeftoverE2eRoutes, closeLeftoverE2eMissions, removeOrganizationB } from './support/stack';

export default async function globalTeardown(): Promise<void> {
  await removeOrganizationB();
  await closeLeftoverE2eMissions();
  await archiveLeftoverE2eRoutes();
}
