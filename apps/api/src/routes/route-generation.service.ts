import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { GenerateRoutesRequest, type OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { JobRunner, type JobContext } from '../jobs/job-runner.js';
import { CalculationJobs } from '../jobs/calculation-jobs.service.js';
import { lockMission, viewerOf } from '../missions/mission-support.js';
import { ROUTING_PROVIDER, type RoutingProvider } from '../routing/routing.js';
import { RouteMeasurement, type MeasuredPath } from './route-measurement.js';
import { RouteWrites } from './route-writes.service.js';

type Body = z.infer<typeof GenerateRoutesRequest>;

/**
 * The name is required since the change on route names (RF-501). A job queued before it may have none: it gets this one, with a
 * warning, instead of failing. The position of the alternative is added.
 */
export const LEGACY_NAME_PREFIX = 'Ruta';
/** What the worker reads back from `calculation_jobs.params`: the same request, with the name optional for those older jobs. */
const StoredParams = GenerateRoutesRequest.partial({ namePrefix: true });

/**
 * `generateRoutes` (RF-501, RN-08, INV-14). The request checks everything that can be checked at once — the mission and its origin,
 * the zones to avoid, whether the engine answers — and puts the calculation in the queue (202 and a job id). The worker then asks the
 * engine, measures every proposal with the server's own elevation (the engine's altitude and metrics are never used, rule 6) and
 * saves all of them, in one transaction, as new routes in Draft, version 1 (and in the mission, if it was asked, with that version
 * pinned). Running the job again does not create anything twice (D-H3-06).
 */
@Injectable()
export class RouteGeneration implements OnModuleInit {
  private readonly logger = new Logger(RouteGeneration.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CalculationJobs) private readonly jobs: CalculationJobs,
    @Inject(JobRunner) private readonly runner: JobRunner,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(RouteMeasurement) private readonly measurement: RouteMeasurement,
    @Inject(RouteWrites) private readonly writes: RouteWrites,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
  ) {}

  onModuleInit(): void {
    this.runner.register('generate', (context) => this.run(context));
  }

  private get tx(): Tx {
    return this.database.current();
  }

  // ---- The request (API) ----

  async request(principal: Principal, body: Body): Promise<OperationOutput<'generateRoutes'>> {
    const { orgId, userId } = viewerOf(principal);
    let missionId: string | null = null;
    if (body.addToMission) {
      missionId = body.addToMission.missionId;
      await this.checkMission(orgId, body.addToMission);
    }
    await this.checkZones(orgId, body.avoidZoneIds);
    // No point queueing work that cannot start: the person is told now, with the engine's own code.
    if (!(await this.routing.isAvailable())) throw new DomainError('ROUTING_UNAVAILABLE');

    const jobId = await this.jobs.create(principal, 'generate', body, missionId);
    await this.audit.recordJobRequested({
      orgId,
      jobId,
      actorUserId: userId,
      detail: { alternatives: body.alternatives, via: body.via.length, avoidZones: body.avoidZoneIds.length, missionId },
    });
    return { jobId };
  }

  /** INV-14: from a mission it takes a target and at least one origin; and a closed mission takes nothing (rule 5). */
  private async checkMission(orgId: string, target: NonNullable<Body['addToMission']>): Promise<void> {
    const mission = await lockMission(this.tx, orgId, target.missionId);
    if (mission.status === 'closed') throw new DomainError('MISSION_CLOSED');
    const { rows } = await this.tx.execute(sql`
      SELECT (SELECT count(*) FROM mission_points WHERE mission_id = ${target.missionId}::uuid AND kind = 'origin')::int AS origins,
             (SELECT target IS NOT NULL FROM missions WHERE id = ${target.missionId}::uuid) AS has_target`);
    const found = (rows as unknown as { origins: number; has_target: boolean }[])[0]!;
    if (found.origins === 0 || !found.has_target) throw new DomainError('MISSION_HAS_NO_ORIGIN');
    if (target.originPointId) {
      const { rows: origin } = await this.tx.execute(sql`SELECT 1 FROM mission_points WHERE id = ${target.originPointId}::uuid AND mission_id = ${target.missionId}::uuid AND kind = 'origin'`);
      if (origin.length === 0) throw new DomainError('NOT_FOUND');
    }
    if (target.teamId) {
      const { rows: team } = await this.tx.execute(sql`SELECT 1 FROM teams WHERE id = ${target.teamId}::uuid AND organization_id = ${orgId}::uuid`);
      if (team.length === 0) throw new DomainError('NOT_FOUND');
    }
  }

  /** Every zone must be one of this organization's: an id that is not there is a 404, not something to ignore (INV-01). */
  private async checkZones(orgId: string, zoneIds: string[]): Promise<void> {
    const unique = [...new Set(zoneIds)];
    if (unique.length === 0) return;
    const { rows } = await this.tx.execute(
      sql`SELECT count(*)::int AS n FROM avoid_zones WHERE organization_id = ${orgId}::uuid AND id IN (${sql.join(
        unique.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    if ((rows as unknown as { n: number }[])[0]!.n !== unique.length) throw new DomainError('NOT_FOUND');
  }

  // ---- The job (worker) ----

  async run({ job, orgId, userId, setProgress }: JobContext): Promise<Record<string, unknown>> {
    const params = StoredParams.parse(job.params);
    const inContext = <T>(fn: () => Promise<T>) => this.database.withContext({ orgId, userId, role: 'coordinator' }, fn);

    // A retry of a job that already saved its routes only reports them.
    const done = await inContext(() => this.writes.generatedBy(job.id));
    if (done.length > 0) return { routeIds: done.map((route) => route.routeId) };

    const rings = await inContext(() => this.ringsOf(orgId, params.avoidZoneIds));
    await setProgress(10);
    const proposals = await this.routing.alternatives({ from: params.from, to: params.to, via: params.via, avoid: rings, count: params.alternatives });
    await setProgress(50);

    const measured: MeasuredPath[] = [];
    for (const [index, proposal] of proposals.entries()) {
      measured.push(await this.measurement.measure(proposal.coordinates, proposal.segments));
      await setProgress(50 + (40 * (index + 1)) / proposals.length);
    }

    const prefix = params.namePrefix ?? LEGACY_NAME_PREFIX;
    if (params.namePrefix === undefined) this.logger.warn(`job ${job.id} has no namePrefix (queued before it was required): using "${LEGACY_NAME_PREFIX}"`);
    const routes = await inContext(async () => {
      const created = await this.writes.createGenerated({ orgId, userId, jobId: job.id, names: measured.map((_, index) => `${prefix} ${index + 1}`), measured });
      if (params.addToMission) await this.linkToMission(orgId, userId, params.addToMission, created);
      return created;
    });
    return { routeIds: routes.map((route) => route.routeId) };
  }

  /** The zones as the closed rings the engine takes, `[lon, lat]`. */
  private async ringsOf(orgId: string, zoneIds: string[]): Promise<[number, number][][]> {
    const unique = [...new Set(zoneIds)];
    if (unique.length === 0) return [];
    const { rows } = await this.tx.execute(sql`
      SELECT ST_AsGeoJSON(geom)::json AS geometry FROM avoid_zones
       WHERE organization_id = ${orgId}::uuid AND id IN (${sql.join(
         unique.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})`);
    return (rows as unknown as { geometry: { coordinates: [number, number][][] } }[]).map((row) => row.geometry.coordinates[0]!);
  }

  /**
   * Puts the new routes in the mission with their version 1 pinned (P5). If the mission was closed while the job ran, the routes stay in
   * the library and are not added (D-H3-10): the policy of `mission_routes` forbids it, and the calculation is not lost.
   */
  private async linkToMission(orgId: string, userId: string, target: NonNullable<Body['addToMission']>, created: { routeId: string; versionId: string; name: string }[]): Promise<void> {
    const mission = await lockMission(this.tx, orgId, target.missionId);
    if (mission.status === 'closed') return;
    for (const route of created) {
      await this.tx.execute(sql`
        INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, origin_point_id, team_id, added_by, added_at)
        VALUES (${orgId}::uuid, ${target.missionId}::uuid, ${route.routeId}::uuid, ${route.versionId}::uuid, ${target.originPointId ?? null}::uuid, ${target.teamId ?? null}::uuid, ${userId}::uuid, clock_timestamp())
        ON CONFLICT (mission_id, route_id) DO NOTHING`);
      await this.audit.recordMission({
        orgId,
        missionId: target.missionId,
        action: 'route_added',
        actorUserId: userId,
        detail: { name: route.name, routeId: route.routeId, versionNumber: 1, source: 'generated' },
      });
    }
  }
}
