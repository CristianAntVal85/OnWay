import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, DocumentInput, Phone } from '@onway/contracts';
import { z } from 'zod';

const EXAMPLE_ORG = /^[^@\s]+@example\.org$/i;
const Email = z.string().max(254).regex(EXAMPLE_ORG, 'demo emails must be on example.org (RFC 2606): nothing here is real (R-10)');

const Key = z.string().min(1).max(40);
const Locale = z.enum(['es', 'fr']);

/**
 * A completed signup (H5-perfil, D-P8): phone, an invented identity document with a valid control letter and an invented address, checked
 * with the same contract schemas as `updateMyProfile`. The seed encrypts them with the API's keys; the file never holds ciphertext.
 */
const DemoProfile = z.strictObject({ phone: Phone, document: DocumentInput, address: Address });

const DemoMember = z.strictObject({
  key: Key,
  email: Email,
  displayName: z.string().trim().min(1).max(120),
  locale: Locale,
  role: z.enum(['admin', 'coordinator', 'rescuer']),
  /** Only rescuers. Without it the rescuer keeps an incomplete profile (the «complete your profile» case). */
  profile: DemoProfile.optional(),
});

const DemoApplicant = z.strictObject({ key: Key, email: Email, displayName: z.string().trim().min(1).max(120), locale: Locale });

const DemoTeam = z.strictObject({
  name: z.string().trim().min(1).max(120),
  locality: z.string().trim().min(1).max(120),
  /** Keys of rescuers (INV-23: a team has a locality; members are rescuers of the organization). */
  members: z.array(Key),
});

const DemoPoint = z.strictObject({
  kind: z.enum(['origin', 'waypoint', 'rendezvous']),
  name: z.string().trim().min(1).max(120),
  note: z.string().trim().min(1).max(500).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/**
 * A route of the library put in a made-up mission (H4-T7, P1), the way `addMissionRoutes` would leave it. The pinned version is the last validated one
 * (or the last, if none is validated) unless `version` says otherwise; `unavailable` marks it as such, with its line of the history.
 */
const DemoMissionRoute = z.strictObject({
  /** Name of a route of `routes`. */
  route: z.string().trim().min(3).max(160),
  version: z.number().int().min(1).max(10).optional(),
  unavailable: z.boolean().default(false),
});

/** A made-up mission (P4 b). Altitudes are not in the file: the seed asks the configured `ElevationProvider`, as the API does (RN-07). */
const DemoMission = z.strictObject({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(2000).optional(),
  status: z.enum(['planning', 'active', 'closed']),
  /** Key of a coordinator of `members`. */
  coordinator: Key,
  target: z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().trim().min(1).max(200).optional() }),
  points: z.array(DemoPoint),
  /** Routes of the library that this mission uses; only a mission that is not closed can have them (INV-11). */
  routes: z.array(DemoMissionRoute).default([]),
});

/** A made-up route (P6): its versions come from invented GPX files in `data/seed/gpx/`; altitudes and metrics are measured at seeding, like the API does (RN-10). */
const DemoRoute = z.strictObject({
  name: z.string().trim().min(3).max(160),
  /** Key of a coordinator of `members`: who created and validated it. */
  coordinator: Key,
  archived: z.boolean().default(false),
  /** Route (by name, earlier in the list) and version number this one is a copy of. */
  derivedFrom: z.strictObject({ route: z.string(), version: z.number().int().min(1) }).optional(),
  versions: z
    .array(
      z.strictObject({
        gpx: z.string().regex(/^[a-z0-9-]+\.gpx$/),
        /** Age of the version; the first one is the oldest. */
        daysAgo: z.number().int().min(0).max(3650),
        /** Present = the version is Validated, that many days ago (never before it was created). */
        validatedDaysAgo: z.number().int().min(0).max(3650).optional(),
        note: z.string().trim().min(1).max(1000).optional(),
      }),
    )
    .min(1)
    .max(10),
});

/**
 * `data/seed/demo.json` (D-H0-17, D-H0-18). It holds no hash and no secret: the single fictitious demo password is
 * public on purpose (data/seed/README.md) and is hashed with Argon2id when the seed runs.
 */
export const Demo = z
  .strictObject({
    notice: z.string().min(1),
    demoPassword: z.string().min(12).max(200),
    organization: z.strictObject({ name: z.string().trim().min(2).max(120), country: z.string().length(2), validationMaxAgeDays: z.number().int().min(1).max(3650) }),
    members: z.array(DemoMember).min(1),
    applicants: z.array(DemoApplicant),
    teams: z.array(DemoTeam),
    missions: z.array(DemoMission).default([]),
    routes: z.array(DemoRoute).default([]),
  })
  .superRefine((demo, ctx) => {
    const keys = new Set<string>();
    const emails = new Set<string>();
    for (const [index, person] of [...demo.members, ...demo.applicants].entries()) {
      if (keys.has(person.key)) ctx.addIssue({ code: 'custom', message: `duplicate key ${person.key}`, path: ['members', index] });
      if (emails.has(person.email.toLowerCase())) ctx.addIssue({ code: 'custom', message: `duplicate email ${person.email}`, path: ['members', index] });
      keys.add(person.key);
      emails.add(person.email.toLowerCase());
    }
    for (const [index, member] of demo.members.entries()) {
      if (member.profile && member.role !== 'rescuer') ctx.addIssue({ code: 'custom', message: `only a rescuer has a profile (${member.key})`, path: ['members', index, 'profile'] });
    }
    const documents = demo.members.flatMap((m) => (m.profile ? [`${m.profile.document.type}:${m.profile.document.number.toUpperCase()}`] : []));
    if (new Set(documents).size !== documents.length) ctx.addIssue({ code: 'custom', message: 'two demo profiles share a document (INV-24)', path: ['members'] });
    const rescuers = new Set(demo.members.filter((m) => m.role === 'rescuer').map((m) => m.key));
    for (const [index, team] of demo.teams.entries()) {
      for (const member of team.members) {
        if (!rescuers.has(member)) ctx.addIssue({ code: 'custom', message: `team member ${member} is not a rescuer of the demo`, path: ['teams', index, 'members'] });
      }
      if (new Set(team.members).size !== team.members.length) ctx.addIssue({ code: 'custom', message: 'a rescuer is listed twice in a team', path: ['teams', index, 'members'] });
    }
    const coordinators = new Set(demo.members.filter((m) => m.role === 'coordinator').map((m) => m.key));
    const names = new Set<string>();
    for (const [index, mission] of demo.missions.entries()) {
      if (!coordinators.has(mission.coordinator))
        ctx.addIssue({ code: 'custom', message: `mission coordinator ${mission.coordinator} is not a coordinator of the demo`, path: ['missions', index, 'coordinator'] });
      // Same rule as the unique index of open missions, applied to the whole file so that re-seeding never depends on the state.
      if (names.has(mission.name.toLowerCase())) ctx.addIssue({ code: 'custom', message: `duplicate mission name ${mission.name}`, path: ['missions', index, 'name'] });
      names.add(mission.name.toLowerCase());
    }
    const routeNames = new Set<string>();
    for (const [index, route] of demo.routes.entries()) {
      if (!coordinators.has(route.coordinator))
        ctx.addIssue({ code: 'custom', message: `route coordinator ${route.coordinator} is not a coordinator of the demo`, path: ['routes', index, 'coordinator'] });
      if (route.derivedFrom && !routeNames.has(route.derivedFrom.route.toLowerCase()))
        ctx.addIssue({ code: 'custom', message: `route derived from ${route.derivedFrom.route}, which is not an earlier route of the demo`, path: ['routes', index, 'derivedFrom'] });
      if (routeNames.has(route.name.toLowerCase())) ctx.addIssue({ code: 'custom', message: `duplicate route name ${route.name}`, path: ['routes', index, 'name'] });
      routeNames.add(route.name.toLowerCase());
      let previous = Number.POSITIVE_INFINITY;
      for (const [v, version] of route.versions.entries()) {
        if (version.daysAgo > previous) ctx.addIssue({ code: 'custom', message: 'versions must go from the oldest to the newest', path: ['routes', index, 'versions', v, 'daysAgo'] });
        if (version.validatedDaysAgo !== undefined && version.validatedDaysAgo > version.daysAgo)
          ctx.addIssue({ code: 'custom', message: 'a version cannot be validated before it was created', path: ['routes', index, 'versions', v, 'validatedDaysAgo'] });
        previous = version.daysAgo;
      }
    }
    for (const [index, mission] of demo.missions.entries()) {
      if (mission.routes.length > 0 && mission.status === 'closed') ctx.addIssue({ code: 'custom', message: 'a closed mission takes no routes (INV-11)', path: ['missions', index, 'routes'] });
      const used = new Set<string>();
      for (const [r, placed] of mission.routes.entries()) {
        const library = demo.routes.find((route) => route.name.toLowerCase() === placed.route.toLowerCase());
        if (!library) ctx.addIssue({ code: 'custom', message: `mission route ${placed.route} is not a route of the demo`, path: ['missions', index, 'routes', r, 'route'] });
        else {
          if (library.archived) ctx.addIssue({ code: 'custom', message: 'an archived route is not added to a mission', path: ['missions', index, 'routes', r, 'route'] });
          if (placed.version !== undefined && placed.version > library.versions.length)
            ctx.addIssue({ code: 'custom', message: `route ${library.name} has no version ${placed.version}`, path: ['missions', index, 'routes', r, 'version'] });
        }
        if (used.has(placed.route.toLowerCase()))
          ctx.addIssue({ code: 'custom', message: `route ${placed.route} appears twice in the mission (INV-13)`, path: ['missions', index, 'routes', r, 'route'] });
        used.add(placed.route.toLowerCase());
      }
    }
  });
export type Demo = z.infer<typeof Demo>;

const SEED_FILE = join('data', 'seed', 'demo.json');

/** `SEED_FILE`, or the first `data/seed/demo.json` found walking up from this file. */
export function resolveSeedFile(env: Record<string, string | undefined> = process.env): string {
  if (env.SEED_FILE) return resolve(env.SEED_FILE);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, SEED_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('data/seed/demo.json not found; set SEED_FILE');
    dir = parent;
  }
}

/** The folder with the invented GPX files of the demo: `gpx/` next to the seed file. */
export const gpxDirOf = (seedFile = resolveSeedFile()): string => join(dirname(seedFile), 'gpx');

export function loadDemo(file = resolveSeedFile()): Demo {
  return Demo.parse(JSON.parse(readFileSync(file, 'utf8')));
}
