import { ownerConnectionFromEnv } from '../db/config.js';
import { createElevationProvider } from '../geo/config.js';
import { loadDemo } from '../seed/demo.js';
import { seedDemo } from '../seed/seed.js';

try {
  const demo = loadDemo();
  // The seed job runs on the internal network (no Internet): only the local DEM answers, never Open-Meteo.
  const elevation = createElevationProvider(process.env, { remote: false });
  const result = await seedDemo(ownerConnectionFromEnv(), demo, { elevation, warn: (message) => console.warn(message) });
  console.log(result.seeded ? 'demo data loaded (fictitious, R-10)' : result.missions > 0 ? 'demo data already present: people and teams unchanged' : 'demo data already present: nothing changed');
  console.log(`demo missions created now: ${result.missions} of ${demo.missions.length}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
