import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ERROR_HTTP, ErrorResponse, FileRef, type ErrorCode } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DatabaseService } from '../../src/db/database.service.js';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// uploadFile (H2-T3): a coordinator attaches a GPX or KML to import; the type is decided from the content. Two organizations on real PostGIS.
let app: TestApp;
let fixtures: Fixtures;
let database: DatabaseService;
const storage = new InMemoryFileStorage();

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
}
let a: Org;
let b: Org;
let applicant: Member;
const sessions = new Map<string, Session>();
const options = { password: TEST_PASSWORD };

async function build(label: string): Promise<Org> {
  const orgId = await fixtures.organization(label);
  return {
    orgId,
    admin: await fixtures.member(orgId, 'admin', 'active', options),
    coordinator: await fixtures.member(orgId, 'coordinator', 'active', options),
    rescuer: await fixtures.member(orgId, 'rescuer', 'active', options),
  };
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, files: { storage } });
  database = app.app.get(DatabaseService);
  a = await build('Org A');
  b = await build('Org B');
  applicant = await fixtures.applicant(a.orgId, 'pending', options);
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function sessionOf(member: Member): Promise<Session> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  return sessions.get(member.userId)!;
}

const fixture = (name: string) => readFile(new URL(`../../../../packages/geo/test/fixtures/${name}`, import.meta.url));

interface Upload {
  purpose?: string;
  content?: Buffer | string | null;
  filename?: string;
  type?: string;
  extra?: Record<string, string>;
}

/** Posts a multipart upload the way a browser's `FormData` does. */
async function upload(member: Member | null, spec: Upload = {}, csrf = true): Promise<Response> {
  const form = new FormData();
  form.set('purpose', spec.purpose ?? 'route_import');
  for (const [key, value] of Object.entries(spec.extra ?? {})) form.set(key, value);
  if (spec.content !== null)
    form.set(
      'file',
      new Blob([typeof spec.content === 'string' || spec.content === undefined ? (spec.content ?? '') : new Uint8Array(spec.content)], { type: spec.type ?? 'application/gpx+xml' }),
      spec.filename ?? 'track.gpx',
    );
  const headers = member ? withSession(await sessionOf(member), csrf) : {};
  return fetch(`${app.baseUrl}/files`, { method: 'POST', headers, body: form });
}

async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

const fileCount = async () => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM files`))[0]!.n);

/** The same bytes must not have left a row or a stored file behind. */
async function expectNothingKept(run: () => Promise<void>) {
  const [rows, stored] = [await fileCount(), storage.size];
  await run();
  expect(await fileCount()).toBe(rows);
  expect(storage.size).toBe(stored);
}

describe('uploadFile: accepts a GPX or KML from the coordinator (RF-510)', () => {
  it('stores a GPX and answers 201 with its reference; the row and the bytes belong to the uploader’s organization (INV-01)', async () => {
    const content = await fixture('ficticio-sendero.gpx');
    const response = await upload(a.coordinator, { content });
    expect(response.status).toBe(201);
    const ref = FileRef.parse(await response.json());
    expect(ref).toMatchObject({ purpose: 'route_import', contentType: 'application/gpx+xml', sizeBytes: content.length });

    const [row] = await fixtures.query<{ organization_id: string; created_by: string; owner_user_id: string | null; storage_key: string; sha256: Buffer; size_bytes: number }>(
      `SELECT organization_id, created_by, owner_user_id, storage_key, sha256, size_bytes FROM files WHERE id = $1`,
      [ref.id],
    );
    expect(row).toMatchObject({ organization_id: a.orgId, created_by: a.coordinator.userId, owner_user_id: null, size_bytes: content.length });
    expect(row!.sha256.equals(createHash('sha256').update(content).digest())).toBe(true);
    expect((await storage.get(row!.storage_key)).equals(content)).toBe(true);
    // The key does not say what the file is, who sent it or from which organization.
    expect(row!.storage_key).not.toMatch(new RegExp(`${a.orgId}|${a.coordinator.userId}|gpx|track`, 'i'));
  });

  it('stores a KML with its own content type', async () => {
    const ref = FileRef.parse(await (await upload(a.coordinator, { content: await fixture('linestring.kml'), filename: 'ruta.kml', type: 'application/vnd.google-earth.kml+xml' })).json());
    expect(ref.contentType).toBe('application/vnd.google-earth.kml+xml');
  });

  it('decides the type from the content: a GPX named .pdf and sent as application/pdf is accepted as GPX', async () => {
    const response = await upload(a.coordinator, { content: await fixture('ficticio-sendero.gpx'), filename: 'informe.pdf', type: 'application/pdf' });
    expect(response.status).toBe(201);
    expect(FileRef.parse(await response.json()).contentType).toBe('application/gpx+xml');
  });

  it('accepts a valid GPX padded to 9 MB, below the limit', async () => {
    const base = (await fixture('ficticio-sendero.gpx')).toString('utf8');
    const content = Buffer.from(base + ' '.repeat(9 * 1024 * 1024));
    const response = await upload(a.coordinator, { content });
    expect(response.status).toBe(201);
    expect(FileRef.parse(await response.json()).sizeBytes).toBe(content.length);
  });
});

describe('uploadFile: rejects what is not a valid GPX or KML, and keeps nothing', () => {
  it('FILE_TOO_LARGE (413) for 11 MB, whatever it contains', async () => {
    await expectNothingKept(async () => {
      await expectError(await upload(a.coordinator, { content: Buffer.alloc(11 * 1024 * 1024, 0x20) }), 'FILE_TOO_LARGE');
    });
  });

  it('UNSUPPORTED_FILE_TYPE (415) for a PDF that is called .gpx, an image and a SVG', async () => {
    await expectNothingKept(async () => {
      const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fictitious body')]);
      await expectError(await upload(a.coordinator, { content: pdf, filename: 'track.gpx', type: 'application/gpx+xml' }), 'UNSUPPORTED_FILE_TYPE');
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      await expectError(await upload(a.coordinator, { content: png, filename: 'track.gpx' }), 'UNSUPPORTED_FILE_TYPE');
      await expectError(await upload(a.coordinator, { content: await fixture('no-es-gpx.svg'), filename: 'track.gpx' }), 'UNSUPPORTED_FILE_TYPE');
    });
  });

  it.each([
    ['malformed XML', 'mal-formado.gpx'],
    ['no track', 'sin-pista.gpx'],
    ['coordinates out of range', 'fuera-de-rango.gpx'],
    ['a broken number', 'numero-roto.gpx'],
    ['an external entity', 'entidad-externa.gpx'],
    ['entities that expand (billion laughs)', 'mil-millones-de-risas.gpx'],
    ['text that is not XML', 'no-es-xml.txt'],
  ])('INVALID_FILE_CONTENT (422) for %s', async (_label, name) => {
    await expectNothingKept(async () => {
      const error = await expectError(await upload(a.coordinator, { content: await fixture(name) }), 'INVALID_FILE_CONTENT');
      expect(JSON.stringify(error)).not.toMatch(/root:|\/etc\/passwd/);
    });
  });

  it('INVALID_FILE_CONTENT for excessive nesting, an empty file and bytes that are not UTF-8', async () => {
    await expectNothingKept(async () => {
      const deep = `<gpx>${'<a>'.repeat(40)}${'</a>'.repeat(40)}</gpx>`;
      await expectError(await upload(a.coordinator, { content: deep }), 'INVALID_FILE_CONTENT');
      await expectError(await upload(a.coordinator, { content: '' }), 'INVALID_FILE_CONTENT');
      await expectError(await upload(a.coordinator, { content: Buffer.from([0xc3, 0x28, 0xa0, 0xa1, 0x3c]) }), 'INVALID_FILE_CONTENT');
    });
  });

  it('VALIDATION_FAILED when the file or the purpose is missing, the purpose is unknown or there is a field the contract does not declare', async () => {
    await expectNothingKept(async () => {
      const content = await fixture('ficticio-sendero.gpx');
      const noFile = await expectError(await upload(a.coordinator, { content: null }), 'VALIDATION_FAILED');
      expect(noFile.details).toMatchObject({ issues: [{ path: 'file' }] });
      await expectError(await upload(a.coordinator, { content, purpose: 'avatar' }), 'VALIDATION_FAILED');
      await expectError(await upload(a.coordinator, { content, extra: { organizationId: b.orgId } }), 'VALIDATION_FAILED');
      const response = await fetch(`${app.baseUrl}/files`, {
        method: 'POST',
        headers: { ...withSession(await sessionOf(a.coordinator)), 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'route_import' }),
      });
      await expectError(response, 'VALIDATION_FAILED');
    });
  });

  it('without the row there is no file: when the insert fails the stored bytes are removed', async () => {
    // A GPX of exactly 7 777 bytes is refused by a trigger that exists only for this test and only for that size.
    const base = (await fixture('ficticio-sendero.gpx')).toString('utf8');
    const content = Buffer.from(base + ' '.repeat(7_777 - Buffer.byteLength(base)));
    expect(content.length).toBe(7_777);
    const name = `files_fail_${randomUUID().replaceAll('-', '')}`;
    await fixtures.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END $$`);
    await fixtures.query(`CREATE TRIGGER ${name} BEFORE INSERT ON files FOR EACH ROW WHEN (NEW.size_bytes = 7777) EXECUTE FUNCTION ${name}()`);
    try {
      await expectNothingKept(async () => {
        await expectError(await upload(a.coordinator, { content }), 'INTERNAL');
      });
    } finally {
      await fixtures.query(`DROP TRIGGER ${name} ON files`);
      await fixtures.query(`DROP FUNCTION ${name}()`);
    }
  });
});

describe('uploadFile: who may upload (rule 2, INV-25)', () => {
  it('the administrator and the rescuer get 403 for route_import, and nothing is kept', async () => {
    await expectNothingKept(async () => {
      const content = await fixture('ficticio-sendero.gpx');
      await expectError(await upload(a.admin, { content }), 'FORBIDDEN');
      await expectError(await upload(a.rescuer, { content }), 'FORBIDDEN');
    });
  });

  it('certificate: the coordinator and the administrator get 403 and nothing is kept', async () => {
    await expectNothingKept(async () => {
      const content = Buffer.from('%PDF-1.7 fictitious');
      await expectError(await upload(a.coordinator, { purpose: 'certificate', content, filename: 'c.pdf', type: 'application/pdf' }), 'FORBIDDEN');
      await expectError(await upload(a.admin, { purpose: 'certificate', content, filename: 'c.pdf', type: 'application/pdf' }), 'FORBIDDEN');
    });
  });

  it('a pending account has no access (INV-25), no session is 401 and a missing CSRF token is 403 before anything is read', async () => {
    await expectNothingKept(async () => {
      const content = await fixture('ficticio-sendero.gpx');
      await expectError(await upload(applicant, { content }), 'ACCOUNT_PENDING');
      await expectError(await upload(null, { content }), 'UNAUTHENTICATED');
      await expectError(await upload(a.coordinator, { content }, false), 'CSRF_FAILED');
    });
  });
});

describe('uploadFile: isolation by organization (INV-01)', () => {
  it('a file uploaded by A is invisible to B at the database, and B’s own file is B’s', async () => {
    const fromA = FileRef.parse(await (await upload(a.coordinator, { content: await fixture('ficticio-sendero.gpx') })).json());
    const fromB = FileRef.parse(await (await upload(b.coordinator, { content: await fixture('solo-ruta.gpx') })).json());
    const seenBy = (member: Member, id: string) =>
      database.withContext({ orgId: member.orgId, userId: member.userId, role: 'coordinator' }, async (tx) => (await tx.execute(sql`SELECT id FROM files WHERE id = ${id}`)).rows.length);
    expect(await seenBy(b.coordinator, fromA.id)).toBe(0);
    expect(await seenBy(a.coordinator, fromA.id)).toBe(1);
    expect(await seenBy(b.coordinator, fromB.id)).toBe(1);
    expect(await seenBy(a.coordinator, fromB.id)).toBe(0);
  });
});

describe('uploadFile: a certificate from the rescuer (RF-808, D-29)', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fictitious certificate')]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  it.each([
    ['a PDF', pdf, 'application/pdf'],
    ['a JPEG', jpeg, 'image/jpeg'],
    ['a PNG', png, 'image/png'],
  ])('%s answers 201 with its type, and the row is the rescuer’s', async (_label, content, contentType) => {
    const response = await upload(a.rescuer, { purpose: 'certificate', content, filename: 'certificado.bin', type: 'application/octet-stream' });
    expect(response.status).toBe(201);
    const ref = FileRef.parse(await response.json());
    expect(ref).toMatchObject({ purpose: 'certificate', contentType, sizeBytes: content.length });
    const [row] = await fixtures.query<{ organization_id: string; owner_user_id: string; created_by: string; purpose: string; storage_key: string; deleted_at: Date | null }>(
      `SELECT organization_id, owner_user_id, created_by, purpose, storage_key, deleted_at FROM files WHERE id = $1`,
      [ref.id],
    );
    expect(row).toMatchObject({ organization_id: a.orgId, owner_user_id: a.rescuer.userId, created_by: a.rescuer.userId, purpose: 'certificate', deleted_at: null });
    expect((await storage.get(row!.storage_key)).equals(content)).toBe(true);
    expect(row!.storage_key).not.toMatch(new RegExp(`${a.orgId}|${a.rescuer.userId}|pdf|jpeg|png|certificado`, 'i'));
  });

  it('decides by content: a text called .pdf is UNSUPPORTED_FILE_TYPE, and a PDF sent as .png is accepted as a PDF', async () => {
    await expectNothingKept(async () => {
      await expectError(await upload(a.rescuer, { purpose: 'certificate', content: 'plain text', filename: 'c.pdf', type: 'application/pdf' }), 'UNSUPPORTED_FILE_TYPE');
      await expectError(await upload(a.rescuer, { purpose: 'certificate', content: await fixture('ficticio-sendero.gpx'), filename: 'c.pdf', type: 'application/pdf' }), 'UNSUPPORTED_FILE_TYPE');
    });
    const ok = await upload(a.rescuer, { purpose: 'certificate', content: pdf, filename: 'c.png', type: 'image/png' });
    expect(FileRef.parse(await ok.json()).contentType).toBe('application/pdf');
  });

  it('INVALID_FILE_CONTENT for an empty file, FILE_TOO_LARGE above 10 MB and VALIDATION_FAILED without a file; nothing is kept', async () => {
    await expectNothingKept(async () => {
      await expectError(await upload(a.rescuer, { purpose: 'certificate', content: '' }), 'INVALID_FILE_CONTENT');
      await expectError(await upload(a.rescuer, { purpose: 'certificate', content: Buffer.concat([pdf, Buffer.alloc(11 * 1024 * 1024)]) }), 'FILE_TOO_LARGE');
      const noFile = await expectError(await upload(a.rescuer, { purpose: 'certificate', content: null }), 'VALIDATION_FAILED');
      expect(noFile.details).toMatchObject({ issues: [{ path: 'file' }] });
    });
  });

  it('a rescuer cannot import a route: route_import stays the coordinator’s', async () => {
    await expectNothingKept(async () => {
      await expectError(await upload(a.rescuer, { content: await fixture('ficticio-sendero.gpx') }), 'FORBIDDEN');
    });
  });

  it('a pending account has no access (INV-25) and the file of A is invisible to B at the database (INV-01)', async () => {
    await expectNothingKept(async () => {
      await expectError(await upload(applicant, { purpose: 'certificate', content: pdf }), 'ACCOUNT_PENDING');
    });
    const ref = FileRef.parse(await (await upload(a.rescuer, { purpose: 'certificate', content: pdf })).json());
    const seenBy = (member: Member, role: 'rescuer' | 'coordinator' | 'admin') =>
      database.withContext({ orgId: member.orgId, userId: member.userId, role }, async (tx) => (await tx.execute(sql`SELECT id FROM files WHERE id = ${ref.id}`)).rows.length);
    expect(await seenBy(a.rescuer, 'rescuer')).toBe(1);
    expect(await seenBy(b.rescuer, 'rescuer')).toBe(0);
    expect(await seenBy(b.admin, 'admin')).toBe(0);
  });
});
