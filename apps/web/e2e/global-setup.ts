import { createOrganizationB } from './support/stack';

// La organización B existe solo mientras dura la ejecución (D-H0-18): nada de ella queda en la demostración.
export default async function globalSetup(): Promise<void> {
  await createOrganizationB();
}
