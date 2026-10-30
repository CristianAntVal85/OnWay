import { ownerConnectionFromEnv } from '../db/config.js';
import { runMigrations } from '../db/migrate.js';

try {
  await runMigrations(ownerConnectionFromEnv());
  console.log('migrations applied');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
