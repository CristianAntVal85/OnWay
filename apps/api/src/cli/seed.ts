import { ownerConnectionFromEnv } from '../db/config.js';
import { createElevationProvider } from '../geo/config.js';
import { loadDemo } from '../seed/demo.js';
import { seedDemo } from '../seed/seed.js';
import { sensitiveKeysFromEnv } from '../sensitive/config.js';

try {
  const demo = loadDemo();
  // The seed job runs on the internal network (no Internet): only the local DEM answers, never Open-Meteo.
  const elevation = createElevationProvider(process.env, { remote: false });
  const result = await seedDemo(ownerConnectionFromEnv(), demo, { elevation, sensitive: sensitiveKeysFromEnv(), warn: (message) => console.warn(message) });
  console.log(
    result.seeded
      ? 'demo data loaded (fictitious, R-10)'
      : result.missions + result.routes + result.missionRoutes + result.profiles > 0
        ? 'demo data already present: people and teams unchanged'
        : 'demo data already present: nothing changed',
  );
  console.log(`demo missions created now: ${result.missions} of ${demo.missions.length}`);
  console.log(`demo routes created now: ${result.routes} of ${demo.routes.length}`);
  console.log(`demo profiles completed now: ${result.profiles} of ${demo.members.filter((m) => m.profile).length}`);
  console.log(`demo routes put in the demo missions now: ${result.missionRoutes} of ${demo.missions.reduce((total, mission) => total + mission.routes.length, 0)}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
