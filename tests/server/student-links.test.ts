/**
 * Personal student links (S10: STU-1..7, D-084; permanent since S13b2: D-115, emergency actions D-118).
 * Fictional data only. Every active student has one link made automatically (also imported ones);
 * the same link is shown again across views and restarts (encrypted at rest); there is no routine
 * revoke or regenerate; deactivating stops the link and reactivating brings it back; admins and the
 * student's current teachers can revoke or replace it in an emergency (typed name, reason, audit).
 * Fragment exchange, strict cookie, rate limit, token never logged, headers, sessions never mix.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.ts';
import { auditEvents, sessions, studentLinks } from '../../src/server/db/schema.ts';
import { openSecret, sealSecret } from '../../src/server/lib/crypto.ts';
import { registeredEndpoints, studentCookieName } from '../../src/server/lib/http.ts';
import { EXCHANGE_FAILURE_WINDOW_MS, EXCHANGE_FREE_FAILURES } from '../../src/server/modules/links/service.ts';
import { Client, makeEnv, seedUser, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink, tokenOf } from '../student-helpers.ts';

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

const adaLink = () => linkUrl(s.teacherA, s.c3a.id, ada.id);
const emergency = (c: Client, who: 'teacher' | 'admin', studentId: string, body: Record<string, unknown>) =>
  c.post(`/api/${who}/students/${studentId}/link/emergency`, body);

describe('permanent links (STU-1, STU-4, D-115)', () => {
  it('every active student has a 256-bit link in the URL fragment; only an HMAC and a ciphertext are stored; it opens a strict session', async () => {
    const url = await adaLink();
    expect(url).toMatch(/^http:\/\/localhost:5173\/s#[A-Za-z0-9_-]{43}$/u);
    const token = tokenOf(url);
    const rows = env.db.select().from(studentLinks).all();
    // Made automatically for both new students, at creation.
    expect(rows.map((r) => r.studentId).sort()).toEqual([ada.id, bora.id].sort());
    expect(rows.every((r) => r.origin === 'auto' && r.createdBy === null && r.tokenCipher?.startsWith('v1.'))).toBe(true);
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

  it('the token encryption is AES-GCM bound to the row and the pepper', () => {
    const sealed = sealSecret('pepper-one-0123456789', 'student-link-token', 'row-1', 'tok');
    expect(openSecret('pepper-one-0123456789', 'student-link-token', 'row-1', sealed)).toBe('tok');
    expect(openSecret('pepper-one-0123456789', 'student-link-token', 'row-2', sealed)).toBeNull();
    expect(openSecret('pepper-two-0123456789', 'student-link-token', 'row-1', sealed)).toBeNull();
    expect(openSecret('pepper-one-0123456789', 'other-purpose', 'row-1', sealed)).toBeNull();
    const at = 20;
    const tampered = sealed.slice(0, at) + (sealed[at] === 'A' ? 'B' : 'A') + sealed.slice(at + 1);
    expect(openSecret('pepper-one-0123456789', 'student-link-token', 'row-1', tampered)).toBeNull();
  });

  it('the shown link is the same on every view, for the admin, and after a server restart', async () => {
    const first = await adaLink();
    expect(await adaLink()).toBe(first);
    expect((await ok(s.admin.get(`/api/admin/students/${ada.id}/link`))).link.url).toBe(first);
    const restarted = await buildApp(env.deps);
    await restarted.ready();
    try {
      const again = new Client({ ...env, app: restarted });
      await again.login('ayse.teacher');
      expect(await linkUrl(again, s.c3a.id, ada.id)).toBe(first);
    } finally {
      await restarted.close();
    }
    expect(env.db.select().from(studentLinks).all()).toHaveLength(2);
  });

  it('students without a link (older data) get one at start-up and lazily on the links page', async () => {
    env.db.delete(studentLinks).run();
    const restarted = await buildApp(env.deps);
    await restarted.ready();
    await restarted.close();
    expect(env.db.select().from(studentLinks).all()).toHaveLength(2);
    env.db.delete(studentLinks).run();
    await openLink(env, await adaLink());
  });

  it('imported students get a link at once (IMP-1)', async () => {
    const batch = await ok(s.teacherA.post('/api/import/batches', { classId: s.c3a.id, text: 'Cem Kurgu\nDila Kurgu' }));
    await ok(s.teacherA.post(`/api/import/batches/${batch.id}/commit`, {}));
    const list = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/student-links`));
    expect(list.students).toHaveLength(4);
    expect(list.students.every((x: { link: { url: string } | null }) => x.link?.url)).toBe(true);
    const cem = list.students.find((x: { fullName: string }) => x.fullName === 'Cem Kurgu');
    await openLink(env, cem.link.url);
  });

  it('there is no routine revoke or regenerate: no such route is registered and the old endpoints answer 404 (D-115)', async () => {
    const routes = [...new Set(registeredEndpoints.map((e) => `${e.method} ${e.path}`))];
    const linkRoutes = routes.filter((r) => /link/u.test(r) && !/invite|signin|email|sign-in/u.test(r));
    expect(linkRoutes.sort()).toEqual(
      [
        'GET /api/teacher/classes/:classId/student-links',
        'POST /api/teacher/students/:studentId/link/emergency',
        'GET /api/admin/students/:studentId/link',
        'POST /api/admin/students/:studentId/link/emergency',
      ].sort(),
    );
    expect((await s.teacherA.post(`/api/teacher/students/${ada.id}/link`)).status).toBe(404);
    expect((await s.teacherA.del(`/api/teacher/students/${ada.id}/link`)).status).toBe(404);
    expect((await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/student-links`, { scope: 'all' })).status).toBe(404);
    expect((await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/student-links/revoke`)).status).toBe(404);
  });

  it('answers unknown and replaced tokens the same way', async () => {
    const first = await adaLink();
    const replaced = await ok(emergency(s.teacherA, 'teacher', ada.id, { action: 'replace', confirmName: 'Ada Kurgu', reason: 'The card was lost on the bus' }));
    expect(replaced.link.generation).toBe(2);
    const answers = [];
    for (const token of [tokenOf(first), 'x'.repeat(43)]) {
      const r = await new Client(env).post('/api/student/session', { token });
      answers.push([r.status, r.body.error.code, r.body.error.details?.reason]);
    }
    expect(answers).toEqual([
      [401, 'UNAUTHENTICATED', 'LINK_INVALID'],
      [401, 'UNAUTHENTICATED', 'LINK_INVALID'],
    ]);
    await openLink(env, replaced.link.url);
  });

  it('rate-limits refused tokens per address, but a valid link still opens (STU-4)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < EXCHANGE_FREE_FAILURES + 1; i++) statuses.push((await new Client(env).post('/api/student/session', { token: `guess-${i}-`.padEnd(43, 'a') })).status);
    expect(statuses.slice(0, EXCHANGE_FREE_FAILURES).every((x) => x === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    await openLink(env, await adaLink());
    env.clock.advance(EXCHANGE_FAILURE_WINDOW_MS + 1);
    expect((await new Client(env).post('/api/student/session', { token: 'z'.repeat(43) })).status).toBe(401);
  });

  it('a whole class behind one school address opens its links in the same minute (STU-1)', async () => {
    for (let i = 0; i < 38; i++) await addStudent(s.teacherA, s.c3a.id, { fullName: `Kurgu Öğrenci ${i}` });
    const list = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/student-links`));
    const urls = list.students.map((x: { link: { url: string } }) => x.link.url) as string[];
    expect(urls).toHaveLength(40);
    for (const url of urls) await openLink(env, url);
    for (const url of urls.slice(0, 10)) await openLink(env, url);
  });

  it('a deactivated student’s link stops working (with open sessions) and works again after reactivation; an erased student’s link is gone', async () => {
    const url = await adaLink();
    const phone = await openLink(env, url);
    await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));
    expect((await phone.get('/api/student/page')).status).toBe(401);
    expect((await new Client(env).post('/api/student/session', { token: tokenOf(url) })).status).toBe(401);
    await ok(s.admin.post(`/api/admin/students/${ada.id}/reactivate`));
    await ok(phone.get('/api/student/page'));
    expect((await ok(s.admin.get(`/api/admin/students/${ada.id}/link`))).link.url).toBe(url);
    // Permanent deletion (D-109) removes the link with the student.
    await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));
    await ok(s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Kurgu' }));
    expect(env.db.select().from(studentLinks).all().some((r) => r.studentId === ada.id)).toBe(false);
    expect((await new Client(env).post('/api/student/session', { token: tokenOf(url) })).status).toBe(401);
  });

  it('only a teacher of the student’s class sees the links page', async () => {
    expect((await s.teacherB.get(`/api/teacher/classes/${s.c3a.id}/student-links`)).status).toBe(403);
  });
});

describe('emergency revoke and replace (D-118, owner amendment 14a)', () => {
  it('revoke stops the link and open sessions at once; nothing is made until someone makes a new link; replace shows a new stable link', async () => {
    const url = await adaLink();
    const phone = await openLink(env, url);
    const revoked = await ok(emergency(s.teacherA, 'teacher', ada.id, { action: 'revoke', confirmName: '  Ada   Kurgu ', reason: 'Shared in a group chat' }));
    expect(revoked.link).toBeNull();
    expect(revoked.revokedAt).toBe(env.clock.now());
    expect((await phone.get('/api/student/page')).status).toBe(401);
    expect((await new Client(env).post('/api/student/session', { token: tokenOf(url) })).status).toBe(401);
    // Not re-created automatically: the links page shows the student without a link.
    const list = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/student-links`));
    const row = list.students.find((x: { id: string }) => x.id === ada.id);
    expect(row.link).toBeNull();
    expect(row.revokedAt).not.toBeNull();
    const restarted = await buildApp(env.deps);
    await restarted.ready();
    await restarted.close();
    expect(env.db.select().from(studentLinks).all().filter((r) => r.studentId === ada.id && r.revokedAt === null)).toHaveLength(0);
    // Revoking again: nothing to revoke.
    expect((await emergency(s.teacherA, 'teacher', ada.id, { action: 'revoke', confirmName: 'Ada Kurgu', reason: 'again please' })).body.error.details.reason).toBe('NO_ACTIVE_LINK');

    const made = await ok(emergency(s.admin, 'admin', ada.id, { action: 'replace', confirmName: 'Ada Kurgu', reason: 'New card for the new term' }));
    expect(made.link.url).not.toBe(url);
    expect(made.link.replacedAt).toBe(env.clock.now());
    expect(await adaLink()).toBe(made.link.url);
    await ok((await openLink(env, made.link.url)).get('/api/student/page'));

    const audits = env.db.select().from(auditEvents).all().filter((a) => a.action.startsWith('student_link.emergency'));
    expect(audits.map((a) => a.action)).toEqual(['student_link.emergency_revoke', 'student_link.emergency_replace']);
    expect(JSON.stringify(audits)).toContain('Shared in a group chat');
    expect(JSON.stringify(audits)).not.toContain(tokenOf(made.link.url));
  });

  it('replace takes effect on the next request for open sessions', async () => {
    const phone = await openLink(env, await adaLink());
    await ok(phone.get('/api/student/page'));
    await ok(emergency(s.teacherA, 'teacher', ada.id, { action: 'replace', confirmName: 'Ada Kurgu', reason: 'Card photographed by others' }));
    expect((await phone.get('/api/student/page')).status).toBe(401);
  });

  it('needs the typed full name and a reason', async () => {
    expect((await emergency(s.teacherA, 'teacher', ada.id, { action: 'revoke', confirmName: 'Bora Kurgu', reason: 'wrong name typed' })).body.error.details.reason).toBe('CONFIRMATION_MISMATCH');
    expect((await emergency(s.teacherA, 'teacher', ada.id, { action: 'revoke', confirmName: 'Ada Kurgu', reason: '' })).status).toBe(400);
    expect((await emergency(s.teacherA, 'teacher', ada.id, { action: 'revoke', confirmName: 'Ada Kurgu' })).status).toBe(400);
    await openLink(env, await adaLink());
  });

  it('permission matrix: admins and the student’s current teachers; other teachers and ended assignments are refused', async () => {
    const body = { action: 'replace', confirmName: 'Ada Kurgu', reason: 'Permission check' };
    expect((await emergency(s.teacherB, 'teacher', ada.id, body)).status).toBe(403);
    expect((await emergency(s.teacherA, 'admin', ada.id, body)).status).toBe(403);
    expect((await emergency(new Client(env), 'teacher', ada.id, body)).status).toBe(401);
    const phone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, bora.id));
    expect((await phone.post(`/api/teacher/students/${ada.id}/link/emergency`, body)).status).toBe(401);
    // A second teacher of 3-A can, until their assignment ends.
    const ozge = await seedUser(env, 'teacher', 'ozge.teacher');
    const ctx = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: ozge.id, classId: s.c3a.id, subjectId: s.maths.id }));
    const second = new Client(env);
    await second.login('ozge.teacher');
    await ok(emergency(second, 'teacher', ada.id, body));
    await ok(s.admin.post(`/api/admin/teaching-contexts/${ctx.id}/end`));
    expect((await emergency(second, 'teacher', ada.id, body)).status).toBe(403);
    await ok(emergency(s.admin, 'admin', ada.id, body));
    expect((await s.teacherB.get(`/api/admin/students/${ada.id}/link`)).status).toBe(403);
  });
});

describe('the token is never logged or stored in clear (STU-6)', () => {
  it('scans logs, the audit log and every answer after showing, opening, using and replacing a link', async () => {
    const url = await adaLink();
    const token = tokenOf(url);
    const phone = await openLink(env, url);
    await ok(phone.get('/api/student/page'));
    await env.app.inject({ method: 'GET', url: `/s#${token}` });
    await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/student-links`));
    await ok(emergency(s.teacherA, 'teacher', ada.id, { action: 'replace', confirmName: 'Ada Kurgu', reason: 'Lost card' }));
    expect(logs.join('\n')).not.toContain(token);
    expect(JSON.stringify(env.db.select().from(auditEvents).all())).not.toContain(token);
    expect(JSON.stringify(env.db.select().from(sessions).all())).not.toContain(token);
    expect(JSON.stringify(env.db.select().from(studentLinks).all())).not.toContain(token);
  });
});

describe('headers on the student page and API (STU-6)', () => {
  it('no referrer, no indexing, no caching', async () => {
    const phone = await openLink(env, await adaLink());
    const api = await phone.get('/api/student/page');
    const page = await env.app.inject({ method: 'GET', url: '/s' });
    const exchange = await new Client(env).post('/api/student/session', { token: 'y'.repeat(43) });
    for (const r of [api, exchange, { headers: page.headers }]) {
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(String(r.headers['x-robots-tag'])).toMatch(/noindex/u);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('uses the __Host- cookie name in production', () => {
    expect(studentCookieName({ config: { isProd: true } } as never)).toBe('__Host-ccs');
    expect(studentCookieName({ config: { isProd: false } } as never)).toBe('ccs');
  });
});

describe('teacher and student sessions never mix (STU-4, STU-5)', () => {
  it('a student cookie opens no teacher endpoint and a teacher cookie opens no student endpoint', async () => {
    const phone = await openLink(env, await adaLink());
    expect((await phone.get(`/api/teacher/contexts/${s.ctxA.id}/goals`)).status).toBe(401);
    expect((await phone.get('/api/auth/me')).status).not.toBe(200);
    expect((await s.teacherA.get('/api/student/page')).status).toBe(401);
    for (const [k, v] of phone.cookies) s.teacherA.cookies.set(k, v);
    expect((await ok(s.teacherA.get('/api/student/page'))).student.fullName).toBe('Ada Kurgu');
    await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goals`));
  });

  it('leaving ends only the student session; the link itself keeps working', async () => {
    const url = await adaLink();
    const phone = await openLink(env, url);
    await ok(phone.post('/api/student/session/end'));
    expect((await phone.get('/api/student/page')).status).toBe(401);
    await ok((await openLink(env, url)).get('/api/student/page'));
  });
});
