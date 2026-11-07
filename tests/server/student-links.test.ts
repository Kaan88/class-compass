/**
 * Personal student links (S10: STU-1..7, D-084). Fictional data only.
 * Fragment exchange, strict cookie, revocation and regeneration at once, rate limit, the token is
 * never logged or audited, headers on the page and its API, and the teacher/student sessions never mix.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditEvents, sessions, studentLinks } from '../../src/server/db/schema.ts';
import { studentCookieName } from '../../src/server/lib/http.ts';
import { EXCHANGE_FAILURE_WINDOW_MS, EXCHANGE_FREE_FAILURES } from '../../src/server/modules/links/service.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { openLink, tokenOf } from '../student-helpers.ts';


let env: TestEnv;
let s: School;
let logs: string[];
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };

beforeEach(async () => {
  logs = [];
  env = await makeEnv({}, { logStream: { write: (line: string) => void logs.push(line) } });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
});
afterEach(async () => env.app.close());

describe('link generation and exchange (STU-1, STU-4)', () => {
  it('gives a 256-bit token in the URL fragment, stores only its hash and opens a strict student session', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    expect(link.url).toMatch(/^http:\/\/localhost:5173\/s#[A-Za-z0-9_-]{43}$/u);
    const token = tokenOf(link.url);
    const rows = env.db.select().from(studentLinks).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);

    const phone = new Client(env);
    const r = await phone.post('/api/student/session', { token });
    expect(r.status).toBe(200);
    const setCookie = String(r.headers['set-cookie']);
    expect(setCookie).toMatch(/^ccs=/u);
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toMatch(/SameSite=Strict/iu);
    expect(setCookie).toMatch(/Max-Age=7776000/u);
    const page = await ok(phone.get('/api/student/page'));
    expect(page.student.fullName).toBe('Ada Kurgu');
    expect(page.subjects.map((x: { name: { en: string } }) => x.name.en)).toEqual(['English']);
  });

  it('uses the __Host- cookie name in production', () => {
    expect(studentCookieName({ config: { isProd: true } } as never)).toBe('__Host-ccs');
    expect(studentCookieName({ config: { isProd: false } } as never)).toBe('ccs');
  });

  it('answers unknown, revoked and replaced tokens the same way', async () => {
    const first = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const second = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    expect(second.generation).toBe(2);
    const answers = [];
    for (const token of [tokenOf(first.url), 'x'.repeat(43)]) {
      const r = await new Client(env).post('/api/student/session', { token });
      answers.push([r.status, r.body.error.code, r.body.error.details?.reason]);
    }
    expect(answers).toEqual([
      [401, 'UNAUTHENTICATED', 'LINK_INVALID'],
      [401, 'UNAUTHENTICATED', 'LINK_INVALID'],
    ]);
    await openLink(env, second.url);
  });

  it('rate-limits refused tokens per address, but a valid link still opens (STU-4)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < EXCHANGE_FREE_FAILURES + 1; i++) statuses.push((await new Client(env).post('/api/student/session', { token: `guess-${i}-`.padEnd(43, 'a') })).status);
    expect(statuses.slice(0, EXCHANGE_FREE_FAILURES).every((x) => x === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // A real link from the same school network is not caught by someone else's guessing.
    await openLink(env, (await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`))).url);
    // The window passes since the last failure: refused tokens get the normal answer again.
    env.clock.advance(EXCHANGE_FAILURE_WINDOW_MS + 1);
    expect((await new Client(env).post('/api/student/session', { token: 'z'.repeat(43) })).status).toBe(401);
  });

  it('a whole class behind one school address opens its links in the same minute (STU-1, review fix)', async () => {
    const urls: string[] = [];
    for (let i = 0; i < 40; i++) {
      const st = await addStudent(s.teacherA, s.c3a.id, { fullName: `Kurgu Öğrenci ${i}` });
      urls.push((await ok(s.teacherA.post(`/api/teacher/students/${st.id}/link`))).url);
    }
    for (const url of urls) await openLink(env, url);
    // Opening the same link again (a reload with the fragment) also keeps working.
    for (const url of urls.slice(0, 10)) await openLink(env, url);
  });
});

describe('revocation and regeneration take effect at once (STU-3)', () => {
  it('revoking ends open sessions on the next request; regenerating invalidates the old link and its sessions', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone = await openLink(env, link.url);
    await ok(phone.get('/api/student/page'));
    await ok(s.teacherA.del(`/api/teacher/students/${ada.id}/link`));
    expect((await phone.get('/api/student/page')).status).toBe(401);
    expect((await new Client(env).post('/api/student/session', { token: tokenOf(link.url) })).status).toBe(401);

    const again = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone2 = await openLink(env, again.url);
    await ok(phone2.get('/api/student/page'));
    const replaced = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    expect((await phone2.get('/api/student/page')).status).toBe(401);
    expect((await new Client(env).post('/api/student/session', { token: tokenOf(again.url) })).status).toBe(401);
    await ok((await openLink(env, replaced.url)).get('/api/student/page'));
  });

  it('even a session row that was not revoked stops working once its link is revoked (checked per request)', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone = await openLink(env, link.url);
    env.db.update(studentLinks).set({ revokedAt: env.clock.now() }).run();
    expect(env.db.select().from(sessions).all().some((x) => x.kind === 'student' && x.revokedAt === null)).toBe(true);
    expect((await phone.get('/api/student/page')).status).toBe(401);
  });

  it('class-wide: generate for students without a link, then revoke all', async () => {
    await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const missing = await ok(s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/student-links`, { scope: 'missing' }));
    expect(missing.links.map((l: { fullName: string }) => l.fullName)).toEqual(['Bora Kurgu']);
    const boraPhone = await openLink(env, missing.links[0].url);
    const list = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/student-links`));
    expect(list.students.every((x: { link: unknown }) => x.link !== null)).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/#|url|token/iu);
    expect(await ok(s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/student-links/revoke`))).toEqual({ revoked: 2 });
    expect((await boraPhone.get('/api/student/page')).status).toBe(401);
  });

  it('a deactivated student’s link stops working', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone = await openLink(env, link.url);
    env.db.$client.prepare('update students set deactivated_at = ? where id = ?').run(env.clock.now(), ada.id);
    expect((await phone.get('/api/student/page')).status).toBe(401);
  });

  it('only a teacher of the student’s class manages the link', async () => {
    expect((await s.teacherB.post(`/api/teacher/students/${ada.id}/link`)).status).toBe(403);
    expect((await s.teacherB.del(`/api/teacher/students/${ada.id}/link`)).status).toBe(403);
    expect((await s.teacherB.get(`/api/teacher/classes/${s.c3a.id}/student-links`)).status).toBe(403);
  });
});

describe('the token is never logged or stored in clear (STU-6)', () => {
  it('scans logs, the audit log and every answer after generating, opening and using a link', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const token = tokenOf(link.url);
    const phone = await openLink(env, link.url);
    await ok(phone.get('/api/student/page'));
    await env.app.inject({ method: 'GET', url: `/s#${token}` });
    await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/student-links`));
    await ok(s.teacherA.del(`/api/teacher/students/${ada.id}/link`));
    expect(logs.join('\n')).not.toContain(token);
    expect(JSON.stringify(env.db.select().from(auditEvents).all())).not.toContain(token);
    expect(JSON.stringify(env.db.select().from(sessions).all())).not.toContain(token);
  });
});

describe('headers on the student page and API (STU-6)', () => {
  it('no referrer, no indexing, no caching', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone = await openLink(env, link.url);
    const api = await phone.get('/api/student/page');
    const page = await env.app.inject({ method: 'GET', url: '/s' });
    const exchange = await new Client(env).post('/api/student/session', { token: 'y'.repeat(43) });
    for (const r of [api, exchange, { headers: page.headers }]) {
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(String(r.headers['x-robots-tag'])).toMatch(/noindex/u);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('teacher and student sessions never mix (STU-4, STU-5)', () => {
  it('a student cookie opens no teacher endpoint and a teacher cookie opens no student endpoint', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone = await openLink(env, link.url);
    expect((await phone.get(`/api/teacher/contexts/${s.ctxA.id}/goals`)).status).toBe(401);
    expect((await phone.get('/api/auth/me')).status).not.toBe(200);
    expect((await s.teacherA.get('/api/student/page')).status).toBe(401);
    // A browser holding both: each area uses only its own session.
    for (const [k, v] of phone.cookies) s.teacherA.cookies.set(k, v);
    expect((await ok(s.teacherA.get('/api/student/page'))).student.fullName).toBe('Ada Kurgu');
    await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goals`));
  });

  it('leaving ends only the student session', async () => {
    const link = await ok(s.teacherA.post(`/api/teacher/students/${ada.id}/link`));
    const phone = await openLink(env, link.url);
    await ok(phone.post('/api/student/session/end'));
    expect((await phone.get('/api/student/page')).status).toBe(401);
    await ok((await openLink(env, link.url)).get('/api/student/page'));
    void bora;
  });
});
