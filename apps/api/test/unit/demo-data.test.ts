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
    expect(Demo.safeParse({ ...raw(), teams: [{ name: 'T', locality: 'L', members: ['admin'] }] }).success).toBe(false);
    expect(Demo.safeParse({ ...raw(), surprise: true }).success).toBe(false);
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
});
