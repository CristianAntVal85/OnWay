import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Demo, loadDemo, resolveSeedFile } from '../../src/seed/demo.js';

const raw = () => JSON.parse(readFileSync(resolveSeedFile(), 'utf8')) as Record<string, unknown>;

describe('data/seed/demo.json (D-H0-18, R-10)', () => {
  const demo = loadDemo();

  it('has the agreed shape: one organization, 1 admin, 2 coordinators (one in French), 6 rescuers, 1 applicant, 4 teams', () => {
    const roles = (role: string) => demo.members.filter((m) => m.role === role);
    expect(roles('admin')).toHaveLength(1);
    expect(roles('coordinator')).toHaveLength(2);
    expect(roles('coordinator').filter((m) => m.locale === 'fr')).toHaveLength(1);
    expect(roles('rescuer')).toHaveLength(6);
    expect(demo.applicants).toHaveLength(1);
    expect(demo.teams).toHaveLength(4);
    expect(new Set(demo.teams.map((t) => t.locality.toLowerCase())).size).toBe(4);
  });

  it('gives every team its code, three characters and unique (D-E1, Q-36)', () => {
    expect(demo.teams.map((t) => t.code)).toEqual(['BSC', 'BNS', 'TRL', 'SBN']);
    expect(new Set(demo.teams.map((t) => t.code)).size).toBe(demo.teams.length);
  });

  it('places rescuers in 0, 1 and 2 teams', () => {
    const perRescuer = demo.members.filter((m) => m.role === 'rescuer').map((m) => demo.teams.filter((t) => t.members.includes(m.key)).length);
    expect(new Set(perRescuer)).toEqual(new Set([0, 1, 2]));
  });

  it('uses only example.org emails (RFC 2606) and unique keys and emails', () => {
    const people = [...demo.members, ...demo.applicants];
    for (const person of people) expect(person.email).toMatch(/@example\.org$/);
    expect(new Set(people.map((p) => p.email)).size).toBe(people.length);
    expect(new Set(people.map((p) => p.key)).size).toBe(people.length);
  });

  it('holds no hash, no secret and no real-looking data: the password is the public fictitious one', () => {
    const text = readFileSync(resolveSeedFile(), 'utf8');
    expect(text).not.toMatch(/\$argon2/);
    expect(text).not.toMatch(/\bhash\b|secret|token|api[_-]?key/i);
    expect(demo.notice).toMatch(/FICTICIOS/);
    // The README documents this very password (rule 10: it is fictitious and declared as such).
    expect(readFileSync(resolveSeedFile().replace('demo.json', 'README.md'), 'utf8')).toContain(demo.demoPassword);
  });

  it('rejects a demo that leaves example.org, repeats a person or puts a non-rescuer in a team', () => {
    const withMembers = (members: unknown[]) => ({ ...raw(), members });
    const first = (raw().members as Record<string, unknown>[])[0]!;
    expect(Demo.safeParse(withMembers([{ ...first, email: 'real.person@gmail.com' }])).success).toBe(false);
    expect(Demo.safeParse(withMembers([first, first])).success).toBe(false);
    expect(Demo.safeParse({ ...raw(), teams: [{ name: 'T', locality: 'L', code: 'LLL', members: ['admin'] }] }).success).toBe(false);
    expect(Demo.safeParse({ ...raw(), surprise: true }).success).toBe(false);
  });

  it('completes rescatista1 to rescatista5 with invented data and leaves rescatista6 incomplete (H5-perfil P1)', () => {
    const rescuers = demo.members.filter((m) => m.role === 'rescuer');
    expect(rescuers.filter((m) => m.profile).map((m) => m.key)).toEqual(['rescuer-1', 'rescuer-2', 'rescuer-3', 'rescuer-4', 'rescuer-5']);
    expect(rescuers.find((m) => m.key === 'rescuer-6')!.profile).toBeUndefined();
    // DNI de numeración evidentemente inventada (00000001 a 00000005), con su letra de control válida; teléfonos de la serie 600 000 1xx.
    for (const member of rescuers.filter((m) => m.profile)) {
      expect(member.profile!.document).toMatchObject({ type: 'dni', number: expect.stringMatching(/^0000000[1-5][A-Z]$/) });
      expect(member.profile!.phone).toMatch(/^\+34 600 000 1\d\d$/);
    }
  });

  it('rejects a profile on a non-rescuer, a wrong control letter and two profiles with the same document (INV-24)', () => {
    const members = raw().members as Record<string, unknown>[];
    const profile = members.find((m) => m.key === 'rescuer-1')!.profile as Record<string, unknown>;
    const replace = (key: string, change: Record<string, unknown>) => ({ ...raw(), members: members.map((m) => (m.key === key ? { ...m, ...change } : m)) });
    expect(Demo.safeParse(replace('admin', { profile })).success).toBe(false);
    expect(Demo.safeParse(replace('rescuer-6', { profile: { ...profile, document: { type: 'dni', number: '00000006A' } } })).success).toBe(false);
    expect(Demo.safeParse(replace('rescuer-6', { profile })).success).toBe(false);
    expect(Demo.safeParse(replace('rescuer-6', { profile: { ...profile, document: { type: 'dni', number: '00000006Y' } } })).success).toBe(true);
  });

  it('has three made-up missions, one per state, the active one with an origin, an intermediate and a rendezvous point (P4 b)', () => {
    expect(demo.missions.map((m) => m.status).sort()).toEqual(['active', 'closed', 'planning']);
    expect(
      demo.missions
        .find((m) => m.status === 'active')!
        .points.map((p) => p.kind)
        .sort(),
    ).toEqual(['origin', 'rendezvous', 'waypoint']);
    for (const mission of demo.missions) {
      expect(mission.name).toMatch(/ficticio/i);
      // Inside the Pyrenees box that geodata downloads (lon -2..4, lat 42..44): the elevation source covers them all.
      for (const place of [mission.target, ...mission.points]) {
        expect(place.lat).toBeGreaterThanOrEqual(42);
        expect(place.lat).toBeLessThan(44);
        expect(place.lon).toBeGreaterThanOrEqual(-2);
        expect(place.lon).toBeLessThan(4);
      }
    }
    expect(new Set(demo.missions.map((m) => m.name.toLowerCase())).size).toBe(3);
  });

  it('rejects a mission with an unknown or non-coordinator responsible, a repeated name or a stray field', () => {
    const missions = raw().missions as Record<string, unknown>[];
    const first = missions[0]!;
    expect(Demo.safeParse({ ...raw(), missions: [{ ...first, coordinator: 'nobody' }] }).success).toBe(false);
    expect(Demo.safeParse({ ...raw(), missions: [{ ...first, coordinator: 'admin' }] }).success).toBe(false);
    expect(Demo.safeParse({ ...raw(), missions: [first, { ...first, name: String(first.name).toUpperCase() }] }).success).toBe(false);
    expect(Demo.safeParse({ ...raw(), missions: [{ ...first, elevationM: 1200 }] }).success).toBe(false);
  });

  it('gives rescatista1 to rescatista5 one to three courses and skills, with a single invented certificate (H5-habilidades)', () => {
    const rescuers = demo.members.filter((m) => m.role === 'rescuer');
    expect(rescuers.map((m) => [m.key, m.skills.length])).toEqual([
      ['rescuer-1', 3],
      ['rescuer-2', 2],
      ['rescuer-3', 1],
      ['rescuer-4', 2],
      ['rescuer-5', 1],
      ['rescuer-6', 0],
    ]);
    expect(demo.members.filter((m) => m.role !== 'rescuer').every((m) => m.skills.length === 0)).toBe(true);
    const withCertificate = rescuers.flatMap((m) => m.skills.filter((skill) => skill.certificate).map(() => m.key));
    expect(withCertificate).toEqual(['rescuer-1']);
  });

  it('rejects a skill with a certificate, an expiry before its date and a repeated name', () => {
    const members = raw().members as Record<string, unknown>[];
    const withSkills = (skills: unknown[]) => ({ ...raw(), members: members.map((m) => (m.key === 'rescuer-3' ? { ...m, skills } : m)) });
    expect(Demo.safeParse(withSkills([{ name: 'Dron', kind: 'skill', certificate: true }])).success).toBe(false);
    expect(Demo.safeParse(withSkills([{ name: 'Curso', kind: 'course', issuedOn: '2026-05-01', expiresOn: '2026-04-01' }])).success).toBe(false);
    expect(
      Demo.safeParse(
        withSkills([
          { name: 'Dron', kind: 'skill' },
          { name: 'dron', kind: 'skill' },
        ]),
      ).success,
    ).toBe(false);
    expect(Demo.safeParse({ ...raw(), members: members.map((m) => (m.key === 'admin' ? { ...m, skills: [{ name: 'X', kind: 'skill' }] } : m)) }).success).toBe(false);
  });
});
