import { removeOrganizationB } from './support/stack';

export default async function globalTeardown(): Promise<void> {
  await removeOrganizationB();
}
