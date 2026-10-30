import { ownerConnectionFromEnv } from '../db/config.js';
import { loadDemo } from '../seed/demo.js';
import { seedDemo } from '../seed/seed.js';

try {
  const demo = loadDemo();
  const result = await seedDemo(ownerConnectionFromEnv(), demo);
  console.log(result.seeded ? 'demo data loaded (fictitious, R-10)' : 'demo data already present: nothing changed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
