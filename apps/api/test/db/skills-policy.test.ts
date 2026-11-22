import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// H5-habilidades (RF-808, D-29, INV-26, INV-28, doc 05): through the real `onway_app` login, the policies of `skills` and `files`, the guard
// `skills_guard` (the certificate is the person's own file with purpose `certificate`) and the CHECK that only a course has one.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const otherOrgId = randomUUID();
const ids = {
  admin: randomUUID(),
  coordinator: randomUUID(),
  rescuer: randomUUID(),
  other: randomUUID(),
  stranger: randomUUID(),
  profile: randomUUID(),
  otherProfile: randomUUID(),
  skill: randomUUID(),
  otherSkill: randomUUID(),
  certificate: randomUUID(),
  otherCertificate: randomUUID(),
  routeImport: randomUUID(),
};

type Role = 'admin' | 'coordinator' | 'rescuer';
type Who = keyof Pick<typeof ids, 'admin' | 'coordinator' | 'rescuer' | 'other'>;
const roleOf: Record<Who, Role> = { admin: 'admin', coordinator: 'coordinator', rescuer: 'rescuer', other: 'rescuer' };
const as = (who: Who) => ({ orgId, userId: ids[who], role: roleOf[who] });

/** Runs `fn` in a transaction of `onway_app` with the context of the real API (doc 05 §6.1); always rolled back. */
async function asApp<T>(context: { orgId: string; userId: string; role: Role }, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)`, [context.orgId, context.userId, context.role]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const insertFile = (client: pg.Pool | pg.PoolClient, id: string, owner_: string | null, purpose: string, org = orgId, createdBy = owner_ ?? ids.coordinator) =>
  client.query(`INSERT INTO files (id, organization_id, owner_user_id, purpose, content_type, size_bytes, storage_key, sha256, created_by) VALUES ($1, $2, $3, $4, 'application/pdf', 1, $5, '\\x00', $6)`, [
    id,
    org,
    owner_,
    purpose,
    `zz/${randomUUID()}`,
    createdBy,
  ]);

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  for (const [id, name] of [
    [orgId, 'Org skills'],
    [otherOrgId, 'Org other'],
  ] as const)
    await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, $2, 'ES', $3)`, [id, name, `INV-${randomUUID()}`]);
  const members: [string, 'admin' | 'coordinator' | 'rescuer', string][] = [
    [ids.admin, 'admin', orgId],
    [ids.coordinator, 'coordinator', orgId],
    [ids.rescuer, 'rescuer', orgId],
    [ids.other, 'rescuer', orgId],
    [ids.stranger, 'admin', otherOrgId],
  ];
  for (const [id, role, org] of members) {
    await owner.query(`INSERT INTO users (id, email, password_hash, display_name, account_status) VALUES ($1, $2, 'x', 'Fictitious', 'active')`, [id, `${role}-${randomUUID()}@example.org`]);
    await owner.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, id, role]);
  }
  await owner.query(`INSERT INTO rescuer_profiles (id, organization_id, user_id, full_name) VALUES ($1, $2, $3, 'Fictitious one'), ($4, $2, $5, 'Fictitious two')`, [
    ids.profile,
    orgId,
    ids.rescuer,
    ids.otherProfile,
    ids.other,
  ]);
  await insertFile(owner, ids.certificate, ids.rescuer, 'certificate');
  await insertFile(owner, ids.otherCertificate, ids.other, 'certificate');
  await insertFile(owner, ids.routeImport, null, 'route_import');
  await owner.query(`INSERT INTO skills (id, organization_id, profile_id, name, kind, certificate_file_id) VALUES ($1, $2, $3, 'Curso', 'course', $4)`, [ids.skill, orgId, ids.profile, ids.certificate]);
  await owner.query(`INSERT INTO skills (id, organization_id, profile_id, name, kind) VALUES ($1, $2, $3, 'Otro curso', 'course')`, [ids.otherSkill, orgId, ids.otherProfile]);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('policies of skills (RF-808)', () => {
  it('the rescuer reads and writes only their own entries', async () => {
    await asApp(as('rescuer'), async (client) => {
      expect((await client.query('SELECT id FROM skills')).rows).toEqual([{ id: ids.skill }]);
      expect((await client.query(`UPDATE skills SET name = 'Editado' WHERE id = $1`, [ids.skill])).rowCount).toBe(1);
      expect((await client.query(`INSERT INTO skills (organization_id, profile_id, name, kind) VALUES ($1, $2, 'Nueva', 'skill')`, [orgId, ids.profile])).rowCount).toBe(1);
      expect((await client.query(`DELETE FROM skills WHERE name = 'Nueva'`)).rowCount).toBe(1);
    });
  });

  it('the rescuer neither changes nor deletes the entries of another, and cannot create one in another profile', async () => {
    await asApp(as('rescuer'), async (client) => {
      expect((await client.query(`UPDATE skills SET name = 'Robado' WHERE id = $1`, [ids.otherSkill])).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM skills WHERE id = $1`, [ids.otherSkill])).rowCount).toBe(0);
    });
    await asApp(as('rescuer'), async (client) => {
      await expect(client.query(`INSERT INTO skills (organization_id, profile_id, name, kind) VALUES ($1, $2, 'Intruso', 'skill')`, [orgId, ids.otherProfile])).rejects.toThrow(/row-level security/);
    });
  });

  it('the coordinator and the administrator read the entries of the organization and write none; another organization sees nothing', async () => {
    for (const who of ['coordinator', 'admin'] as const) {
      await asApp(as(who), async (client) => {
        expect((await client.query('SELECT 1 FROM skills')).rowCount).toBe(2);
        expect((await client.query(`UPDATE skills SET name = 'Tocado'`)).rowCount).toBe(0);
        expect((await client.query(`DELETE FROM skills`)).rowCount).toBe(0);
      });
      await asApp(as(who), async (client) => {
        await expect(client.query(`INSERT INTO skills (organization_id, profile_id, name, kind) VALUES ($1, $2, 'Intruso', 'skill')`, [orgId, ids.profile])).rejects.toThrow(/row-level security/);
      });
    }
    await asApp({ orgId: otherOrgId, userId: ids.stranger, role: 'admin' }, async (client) => {
      expect((await client.query('SELECT 1 FROM skills')).rowCount).toBe(0);
    });
  });
});

describe('policies of files for certificates (INV-26, INV-28)', () => {
  it('the owner reads their own certificate and not another person’s; the staff reads those of the organization; another organization none', async () => {
    await asApp(as('rescuer'), async (client) => {
      expect((await client.query(`SELECT id FROM files WHERE purpose = 'certificate'`)).rows).toEqual([{ id: ids.certificate }]);
    });
    for (const who of ['coordinator', 'admin'] as const) {
      await asApp(as(who), async (client) => {
        expect((await client.query(`SELECT 1 FROM files WHERE purpose = 'certificate'`)).rowCount).toBe(2);
      });
    }
    await asApp({ orgId: otherOrgId, userId: ids.stranger, role: 'admin' }, async (client) => {
      expect((await client.query('SELECT 1 FROM files')).rowCount).toBe(0);
    });
  });

  it('a certificate is inserted only in the owner’s own name; route_import only by the coordinator, never by the rescuer or the administrator', async () => {
    await asApp(as('rescuer'), async (client) => {
      await insertFile(client, randomUUID(), ids.rescuer, 'certificate');
    });
    await asApp(as('rescuer'), async (client) => {
      await expect(insertFile(client, randomUUID(), ids.other, 'certificate')).rejects.toThrow(/row-level security/);
    });
    await asApp(as('rescuer'), async (client) => {
      await expect(insertFile(client, randomUUID(), null, 'route_import', orgId, ids.rescuer)).rejects.toThrow(/row-level security/);
    });
    await asApp(as('coordinator'), async (client) => {
      await insertFile(client, randomUUID(), null, 'route_import', orgId, ids.coordinator);
    });
    // The policy asks for the owner and the purpose, not for the role: that only a rescuer uploads a certificate is the service's rule (FORBIDDEN, T2).
    await asApp(as('admin'), async (client) => {
      await expect(insertFile(client, randomUUID(), null, 'route_import', orgId, ids.admin)).rejects.toThrow(/row-level security/);
    });
    await asApp(as('admin'), async (client) => {
      await expect(insertFile(client, randomUUID(), ids.rescuer, 'certificate', orgId, ids.admin)).rejects.toThrow(/row-level security/); // not in another's name
    });
  });

  it('the owner marks their certificate as deleted (soft delete), nobody deletes a row, and another rescuer changes nothing', async () => {
    await asApp(as('rescuer'), async (client) => {
      expect((await client.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [ids.certificate])).rowCount).toBe(1);
      expect((await client.query(`DELETE FROM files WHERE id = $1`, [ids.certificate])).rowCount).toBe(0); // no DELETE policy
    });
    await asApp(as('other'), async (client) => {
      expect((await client.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [ids.certificate])).rowCount).toBe(0);
    });
  });
});

describe('skills_guard and the CHECK of the certificate (D-29)', () => {
  const attach = (client: pg.PoolClient, fileId: string, kind = 'course') =>
    client.query(`INSERT INTO skills (organization_id, profile_id, name, kind, certificate_file_id) VALUES ($1, $2, 'Con archivo', $3, $4)`, [orgId, ids.profile, kind, fileId]);

  it('attaches the own certificate to a course', async () => {
    await asApp(as('rescuer'), async (client) => {
      expect((await attach(client, ids.certificate)).rowCount).toBe(1);
    });
  });

  it('refuses the file of another person and a route_import, on insert and on update', async () => {
    for (const fileId of [ids.otherCertificate, ids.routeImport]) {
      await asApp(as('rescuer'), async (client) => {
        await expect(attach(client, fileId)).rejects.toThrow(/certificado debe ser un archivo propio/);
      });
      await asApp(as('rescuer'), async (client) => {
        await expect(client.query(`UPDATE skills SET certificate_file_id = $1 WHERE id = $2`, [fileId, ids.skill])).rejects.toThrow(/certificado debe ser un archivo propio|violates foreign key|row-level/);
      });
    }
  });

  it('a skill (not a course) carries no certificate', async () => {
    await asApp(as('rescuer'), async (client) => {
      await expect(attach(client, ids.certificate, 'skill')).rejects.toThrow(/check constraint/);
    });
    await asApp(as('rescuer'), async (client) => {
      await expect(client.query(`UPDATE skills SET kind = 'skill' WHERE id = $1`, [ids.skill])).rejects.toThrow(/check constraint/);
    });
  });

  it('an expiry before the date is refused', async () => {
    await asApp(as('rescuer'), async (client) => {
      await expect(
        client.query(`INSERT INTO skills (organization_id, profile_id, name, kind, issued_on, expires_on) VALUES ($1, $2, 'Caducado', 'course', '2026-05-01', '2026-04-01')`, [orgId, ids.profile]),
      ).rejects.toThrow(/check constraint/);
    });
  });
});
