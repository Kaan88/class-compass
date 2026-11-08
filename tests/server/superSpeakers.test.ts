/**
 * Super Speakers (S12, SSP-1..12, D-127..D-134): the school-wide module switch, scorer and board links
 * (fragment token exchange, revoke and regenerate take effect at once), pairing codes for the installed
 * iPhone app, +1 and own undo through the idempotent scorer outbox endpoint, the per-scorer rate limit,
 * participating classes, the board (dense podium, class totals with zeros, placeholder, weekly window,
 * ETag), the Server-Sent Events stream, admin void and award log, the weekly history with CSV, the
 * class+subject report section, the Super Speakers badges and the token-never-logged check.
 * Fictional data only.
 */
import type { AddressInfo } from 'node:net';
import { v7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAchievementId } from '../../src/shared/achievements.ts';
import { SCHOOL_MODULES } from '../../src/shared/modules.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);
const DAY = 24 * 3600_000;

let env: TestEnv;
let s: School;
let logs: string[];
let isik: { id: string; fullName: string };
let ada: { id: string; fullName: string };
let cem: { id: string; fullName: string };

async function enable() {
  await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
}

async function newScorer(label = 'Ms Deniz', extra: Record<string, unknown> = {}) {
  const link = await ok(s.admin.post('/api/admin/speakers/scorers', { label, ...extra }));
  const phone = new Client(env);
  await ok(phone.post('/api/scorer/session', { token: tokenOf(link.url) }));
  return { link, phone };
}

async function newBoard(label = 'Hall screen') {
  const link = await ok(s.admin.post('/api/admin/speakers/displays', { label }));
  const screen = new Client(env);
  await ok(screen.post('/api/board/session', { token: tokenOf(link.url) }));
  return { link, screen };
}

type Res = { opId: string; ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };
async function send(phone: Client, type: string, payload: Record<string, unknown>, opId = v7(), asScorer?: string): Promise<Res> {
  const r = await ok(phone.post('/api/scorer/commands', { commands: [{ opId, type, payload }], ...(asScorer ? { asScorer } : {}) }));
  return r.results[0] as Res;
}
const award = (phone: Client, studentId: string, opId?: string) => send(phone, 'points.award', { studentId }, opId);

beforeEach(async () => {
  logs = [];
  env = await makeEnv({ SPEAKERS_HEARTBEAT_MS: 500 }, { logStream: { write: (line: string) => void logs.push(line) } });
  s = await buildSchool(env);
  isik = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Işık Yıldız', studentNumber: '1203' });
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  cem = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Cem Örnek' });
});
afterEach(() => env.app.close());

describe('module and settings (D-127, D-131)', () => {
  it('is a school-wide module, off by default, with its own policy key', async () => {
    expect(SCHOOL_MODULES).toContain('superSpeakers');
    expect(SERVER_MODULES.find((m) => m.key === 'superSpeakers')?.policyKey).toBe('superSpeakers');
    const o = await ok(s.admin.get('/api/admin/speakers'));
    expect(o.enabled).toBe(false);
    expect(o.settings).toMatchObject({ weekStartsOn: 1, participatingClassIds: null, undoWindowMinutes: 10, rateLimitMax: 60, rateLimitWindowMinutes: 10, boardSound: false, theme: 'explorer' });
    // The badges go to the subject named "English" by default.
    expect(o.badgeSubject?.id).toBe(s.english.id);
    expect(o.classes.map((c: any) => c.name)).toEqual(['3-A', '3-B']);
  });

  it('refuses points while switched off, and keeps the links working for when it is on again', async () => {
    const { phone } = await newScorer();
    expect((await ok(phone.get('/api/scorer/me'))).enabled).toBe(false);
    expect((await phone.get('/api/scorer/students')).status).toBe(403);
    const r = await award(phone, isik.id);
    expect(r).toMatchObject({ ok: false, error: { reason: 'SPEAKERS_OFF' } });
    await enable();
    expect((await award(phone, isik.id)).ok).toBe(true);
  });

  it('validates settings and audits changes', async () => {
    expect((await s.admin.put('/api/admin/speakers/settings', { participatingClassIds: ['0190f0f0-0000-7000-8000-000000000000'] })).body.error.details.reason).toBe('UNKNOWN_CLASS');
    expect((await s.admin.put('/api/admin/speakers/settings', { undoWindowMinutes: 0 })).status).toBe(400);
    const saved = await ok(s.admin.put('/api/admin/speakers/settings', { participatingClassIds: [s.c3b.id], boardTitle: { en: 'English Stars', tr: 'İngilizce Yıldızları' } }));
    expect(saved.participatingClassIds).toEqual([s.c3b.id]);
    const n = env.db.$client.prepare(`select count(*) as n from audit_events where action = 'speakers.settings'`).get() as { n: number };
    expect(n.n).toBe(1);
    // Teachers cannot change anything here.
    expect((await s.teacherA.put('/api/admin/speakers/settings', { boardSound: true })).status).toBe(403);
  });
});

describe('scorer links, sessions and commands (D-128, D-130)', () => {
  beforeEach(enable);

  it('exchanges the fragment token for a scorer session that sees only participating students', async () => {
    const { link, phone } = await newScorer('Ms Deniz', { locale: 'tr', userId: s.ayse.id });
    expect(link.url).toMatch(/\/p#.{20,}$/u);
    expect(link).toMatchObject({ label: 'Ms Deniz', locale: 'tr', userName: expect.any(String), revokedAt: null });
    expect([...phone.cookies.keys()]).toEqual(['ccp']);
    expect(await ok(phone.get('/api/scorer/me'))).toMatchObject({ id: link.id, label: 'Ms Deniz', locale: 'tr', enabled: true, undoWindowMinutes: 10 });
    const list = await ok(phone.get('/api/scorer/students'));
    expect(list.students.map((x: any) => x.fullName)).toEqual(['Ada Kurgu', 'Cem Örnek', 'Işık Yıldız']);
    expect(list.students.find((x: any) => x.id === isik.id)).toMatchObject({ className: '3-A', studentNumber: '1203', initials: 'IY' });
    // Only the classes taking part.
    await ok(s.admin.put('/api/admin/speakers/settings', { participatingClassIds: [s.c3b.id] }));
    expect((await ok(phone.get('/api/scorer/students'))).students.map((x: any) => x.fullName)).toEqual(['Cem Örnek']);
    expect(await award(phone, isik.id)).toMatchObject({ ok: false, error: { reason: 'NOT_PARTICIPATING' } });
    expect((await award(phone, cem.id)).ok).toBe(true);
  });

  it('refuses a wrong or revoked token with the same answer', async () => {
    const stranger = new Client(env);
    const bad = await stranger.post('/api/scorer/session', { token: 'x'.repeat(43) });
    expect(bad.status).toBe(401);
    expect(bad.body.error.details.reason).toBe('LINK_INVALID');
  });

  it('applies +1 once per opId (idempotent replay) and records the scorer link, class snapshot and audit', async () => {
    const { link, phone } = await newScorer('Mr Can', { userId: s.ayse.id });
    const opId = v7();
    const first = await award(phone, isik.id, opId);
    expect(first).toMatchObject({ ok: true, replayed: false, result: { eventId: opId, studentId: isik.id } });
    const again = await award(phone, isik.id, opId);
    expect(again).toMatchObject({ ok: true, replayed: true });
    const rows = env.db.$client.prepare('select * from point_events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: opId, student_id: isik.id, scorer_link_id: link.id, user_id: s.ayse.id, class_id_snapshot: s.c3a.id, class_name_snapshot: '3-A', local_date: '2026-11-09', week_start: '2026-11-09' });
    const auditRow = env.db.$client.prepare(`select actor_type, actor_id from audit_events where action = 'speakers.award'`).get() as any;
    expect(auditRow).toEqual({ actor_type: 'scorer', actor_id: link.id });
    const mine = await ok(phone.get('/api/scorer/awards'));
    expect(mine.today).toMatchObject([{ id: opId, fullName: 'Işık Yıldız', className: '3-A', voidedAt: null }]);
    expect(mine.recentStudentIds).toEqual([isik.id]);
  });

  it('refuses commands queued under another scorer link and anything but points', async () => {
    const { phone } = await newScorer();
    const other = await newScorer('Other');
    const r = await phone.post('/api/scorer/commands', { commands: [{ opId: v7(), type: 'points.award', payload: { studentId: isik.id } }], asScorer: other.link.id });
    expect(r.status).toBe(409);
    expect(r.body.error.details.reason).toBe('WRONG_ACCOUNT');
    expect(await send(phone, 'counter.increment', { studentId: isik.id })).toMatchObject({ ok: false, error: { reason: 'SCORER_ONLY' } });
    // A teacher's classroom outbox cannot give Super Speakers points.
    const t = await ok(s.teacherA.post('/api/commands', { commands: [{ opId: v7(), type: 'points.award', payload: { studentId: isik.id } }] }));
    expect(t.results[0]).toMatchObject({ ok: false, error: { reason: 'SCORER_ONLY' } });
  });

  it('lets a scorer undo only their own points, only within the undo window', async () => {
    const { phone } = await newScorer();
    const other = await newScorer('Other');
    const a = await award(phone, isik.id);
    expect(await send(other.phone, 'points.voidOwn', { eventId: a.opId })).toMatchObject({ ok: false, error: { reason: 'NOT_YOUR_AWARD' } });
    expect((await send(phone, 'points.voidOwn', { eventId: a.opId })).ok).toBe(true);
    expect((env.db.$client.prepare('select voided_at, voided_by from point_events where id = ?').get(a.opId) as any).voided_by).toMatch(/^scorer:/u);
    const b = await award(phone, isik.id);
    env.clock.advance(10 * 60_000 + 1);
    expect(await send(phone, 'points.voidOwn', { eventId: b.opId })).toMatchObject({ ok: false, error: { reason: 'POINT_UNDO_PASSED' } });
  });

  it('limits awards per scorer link in the rate window', async () => {
    await ok(s.admin.put('/api/admin/speakers/settings', { rateLimitMax: 5, rateLimitWindowMinutes: 10 }));
    const { phone } = await newScorer();
    const other = await newScorer('Other');
    for (let i = 0; i < 5; i++) expect((await award(phone, isik.id)).ok).toBe(true);
    expect(await award(phone, isik.id)).toMatchObject({ ok: false, error: { reason: 'SCORER_RATE_LIMIT' } });
    // Another scorer is not affected; the window moves on.
    expect((await award(other.phone, isik.id)).ok).toBe(true);
    env.clock.advance(10 * 60_000 + 1);
    expect((await award(phone, isik.id)).ok).toBe(true);
  });

  it('revoke and regenerate take effect at once; regenerate keeps the history on the same link', async () => {
    const { link, phone } = await newScorer();
    expect((await award(phone, isik.id)).ok).toBe(true);
    const fresh = await ok(s.admin.post(`/api/admin/speakers/scorers/${link.id}/regenerate`));
    expect(fresh.id).toBe(link.id);
    expect(fresh.generation).toBe(link.generation + 1);
    expect((await phone.get('/api/scorer/me')).status).toBe(401);
    expect((await new Client(env).post('/api/scorer/session', { token: tokenOf(link.url) })).status).toBe(401);
    const again = new Client(env);
    await ok(again.post('/api/scorer/session', { token: tokenOf(fresh.url) }));
    expect((await ok(again.get('/api/scorer/awards'))).today).toHaveLength(1);
    await ok(s.admin.post(`/api/admin/speakers/scorers/${link.id}/revoke`));
    expect((await again.get('/api/scorer/me')).status).toBe(401);
    expect((await new Client(env).post('/api/scorer/session', { token: tokenOf(fresh.url) })).status).toBe(401);
    const listed = (await ok(s.admin.get('/api/admin/speakers'))).scorerLinks[0];
    expect(listed).toMatchObject({ id: link.id, url: null, revokedAt: expect.any(Number) });
  });

  it('only links scorer links to active teacher accounts', async () => {
    const r = await s.admin.post('/api/admin/speakers/scorers', { label: 'Admin', userId: s.adminUser.id });
    expect(r.body.error.details.reason).toBe('NOT_A_TEACHER');
  });
});

describe('pairing codes for the installed app (D-129)', () => {
  beforeEach(enable);

  it('are six digits, single use and expire after 10 minutes', async () => {
    const { link, phone } = await newScorer();
    const { code, expiresAt } = await ok(phone.post('/api/scorer/pairing'));
    expect(code).toMatch(/^\d{6}$/u);
    expect(expiresAt - env.clock.now()).toBe(10 * 60_000);
    const app = new Client(env);
    await ok(app.post('/api/scorer/pair', { code }));
    expect((await ok(app.get('/api/scorer/me'))).id).toBe(link.id);
    const second = new Client(env);
    const reused = await second.post('/api/scorer/pair', { code });
    expect(reused.status).toBe(401);
    expect(reused.body.error.details.reason).toBe('PAIRING_CODE_INVALID');
    const late = (await ok(phone.post('/api/scorer/pairing'))).code;
    env.clock.advance(10 * 60_000);
    expect((await second.post('/api/scorer/pair', { code: late })).status).toBe(401);
    // A newer code replaces an unused older one.
    const c1 = (await ok(phone.post('/api/scorer/pairing'))).code;
    const c2 = (await ok(phone.post('/api/scorer/pairing'))).code;
    if (c1 !== c2) expect((await second.post('/api/scorer/pair', { code: c1 })).status).toBe(401);
    await ok(second.post('/api/scorer/pair', { code: c2 }));
    // Revoking the link ends the paired app's session too.
    await ok(s.admin.post(`/api/admin/speakers/scorers/${link.id}/revoke`));
    expect((await app.get('/api/scorer/me')).status).toBe(401);
    expect((await second.get('/api/scorer/me')).status).toBe(401);
  });

  it('stops guessing after 10 wrong codes from one address', async () => {
    const guesser = new Client(env);
    for (let i = 0; i < 10; i++) expect((await guesser.post('/api/scorer/pair', { code: String(100000 + i) })).status).toBe(401);
    expect((await guesser.post('/api/scorer/pair', { code: '123456' })).status).toBe(429);
  });
});

describe('the board (SSP-1..3, D-133)', () => {
  beforeEach(enable);

  it('shows the placeholder state and every class with 0 before any point', async () => {
    const { screen } = await newBoard();
    expect([...screen.cookies.keys()]).toEqual(['ccb']);
    const b = await ok(screen.get('/api/board'));
    expect(b).toMatchObject({ enabled: true, places: [], updatedAt: null, week: { start: '2026-11-09', end: '2026-11-15' }, timezone: 'Europe/Istanbul', sound: false });
    expect(b.classes).toEqual([
      { classId: s.c3a.id, name: '3-A', points: 0 },
      { classId: s.c3b.id, name: '3-B', points: 0 },
    ]);
  });

  it('ranks the top three densely with full names and classes, hides zero and voided points, and answers 304 when unchanged', async () => {
    const { phone } = await newScorer();
    const { screen } = await newBoard();
    const bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
    const deniz = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Deniz Su' });
    for (let i = 0; i < 3; i++) await award(phone, isik.id);
    for (let i = 0; i < 2; i++) await award(phone, ada.id);
    for (let i = 0; i < 2; i++) await award(phone, cem.id);
    await award(phone, bora.id);
    const voided = await award(phone, deniz.id);
    await ok(s.admin.post(`/api/admin/speakers/awards/${voided.opId}/void`, { reason: 'Given by mistake' }));
    const r = await screen.req('GET', '/api/board');
    const b = r.body;
    expect(b.places.map((p: any) => [p.rank, p.points, p.students.map((x: any) => `${x.fullName} (${x.className})`), p.more])).toEqual([
      [1, 3, ['Işık Yıldız (3-A)'], 0],
      [2, 2, ['Ada Kurgu (3-A)', 'Cem Örnek (3-B)'], 0],
      [3, 1, ['Bora Kurgu (3-A)'], 0],
    ]);
    expect(JSON.stringify(b)).not.toContain('Deniz Su');
    expect(b.classes).toEqual([
      { classId: s.c3a.id, name: '3-A', points: 6 },
      { classId: s.c3b.id, name: '3-B', points: 2 },
    ]);
    const etag = r.headers.etag as string;
    expect((await screen.req('GET', '/api/board', undefined, { 'if-none-match': etag })).status).toBe(304);
    await award(phone, bora.id);
    expect((await screen.req('GET', '/api/board', undefined, { 'if-none-match': etag })).status).toBe(200);
  });

  it('starts fresh at the start of the next week (time window only; history kept)', async () => {
    const { phone } = await newScorer();
    const { screen } = await newBoard();
    await award(phone, isik.id);
    const before = await ok(screen.get('/api/board'));
    expect(before.places).toHaveLength(1);
    // Sunday 23:59 Istanbul: still this week.
    env.clock.t = Date.UTC(2026, 10, 15, 20, 59, 0);
    expect((await ok(screen.get('/api/board'))).places).toHaveLength(1);
    // Monday 00:00 Istanbul: a new week.
    env.clock.t = Date.UTC(2026, 10, 15, 21, 0, 0);
    const after = await ok(screen.get('/api/board'));
    expect(after.places).toEqual([]);
    expect(after.week).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(after.version).not.toBe(before.version);
    await s.admin.login('root.admin');
    const hist = await ok(s.admin.get('/api/admin/speakers/history?from=2026-11-01&to=2026-11-30'));
    expect(hist.section.tables.find((t: any) => t.key === 'winners').rows).toHaveLength(1);
  });

  it('display sessions can only read the board; revoking the link stops it at once', async () => {
    const { link, screen } = await newBoard();
    expect((await screen.get('/api/scorer/me')).status).toBe(401);
    expect((await screen.get('/api/admin/speakers')).status).toBe(401);
    await ok(s.admin.post(`/api/admin/speakers/displays/${link.id}/revoke`));
    expect((await screen.get('/api/board')).status).toBe(401);
  });

  it('shows the board as off while the module is off', async () => {
    const { screen } = await newBoard();
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'disabled' }));
    expect(await ok(screen.get('/api/board'))).toMatchObject({ enabled: false, places: [], classes: [] });
  });
});

describe('board events (SSE, D-134)', () => {
  beforeEach(enable);

  it('sends the version at once, a new version after an award, and heartbeats', async () => {
    const { phone } = await newScorer();
    const { screen } = await newBoard();
    await env.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (env.app.server.address() as AddressInfo).port;
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/board/events`, { headers: { cookie: [...screen.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, signal: ctl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/u);
    expect(res.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    let text = '';
    const until = async (pred: () => boolean, ms = 4000) => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return pred();
    };
    const versions = () => [...text.matchAll(/event: version\ndata: (\w+)/gu)].map((m) => m[1]);
    expect(await until(() => versions().length === 1)).toBe(true);
    expect(versions()[0]).toBe((await ok(screen.get('/api/board'))).version);
    await award(phone, isik.id);
    expect(await until(() => versions().length === 2)).toBe(true);
    expect(versions()[1]).toBe((await ok(screen.get('/api/board'))).version);
    expect(await until(() => text.includes(': hb'))).toBe(true);
    ctl.abort();
    // An unauthenticated stream is refused before it opens.
    expect((await fetch(`http://127.0.0.1:${port}/api/board/events`)).status).toBe(401);
  });
});

describe('admin: award log, void, history, report section, badges (SSP-9..12, D-132)', () => {
  beforeEach(enable);

  it('lists awards with filters and voids with a reason (audited)', async () => {
    const { link, phone } = await newScorer('Ms Deniz');
    const a = await award(phone, isik.id);
    await award(phone, cem.id);
    const all = await ok(s.admin.get('/api/admin/speakers/awards'));
    expect(all.awards.map((x: any) => x.fullName).sort()).toEqual(['Cem Örnek', 'Işık Yıldız']);
    const only3b = await ok(s.admin.get(`/api/admin/speakers/awards?classId=${s.c3b.id}`));
    expect(only3b.awards.map((x: any) => x.fullName)).toEqual(['Cem Örnek']);
    expect((await ok(s.admin.get(`/api/admin/speakers/awards?scorerLinkId=${link.id}`))).awards).toHaveLength(2);
    expect((await s.admin.post(`/api/admin/speakers/awards/${a.opId}/void`, { reason: 'x' })).status).toBe(400);
    const v = await ok(s.admin.post(`/api/admin/speakers/awards/${a.opId}/void`, { reason: 'Not in English' }));
    expect(v).toMatchObject({ voidedByKind: 'admin', voidReason: 'Not in English' });
    expect((await ok(s.admin.get('/api/admin/speakers/awards?includeVoided=0'))).awards.map((x: any) => x.fullName)).toEqual(['Cem Örnek']);
    const row = env.db.$client.prepare(`select actor_type from audit_events where action = 'speakers.void'`).get() as any;
    expect(row.actor_type).toBe('user');
  });

  it('gives the weekly history with winners, class, scorer and student tables, and CSV', async () => {
    const { phone } = await newScorer('Ms Deniz');
    await award(phone, isik.id);
    await award(phone, isik.id);
    await award(phone, cem.id);
    env.clock.advance(7 * DAY);
    await award(phone, ada.id);
    await s.admin.login('root.admin');
    const h = await ok(s.admin.get('/api/admin/speakers/history?from=2026-11-09&to=2026-11-22'));
    const tbl = (k: string) => h.section.tables.find((t: any) => t.key === k);
    expect(tbl('winners').rows).toHaveLength(3);
    expect(tbl('classes').rows.length).toBeGreaterThanOrEqual(2);
    expect(tbl('scorers').rows).toHaveLength(1);
    expect(tbl('students').rows).toHaveLength(3);
    const csv = await s.admin.req('GET', '/api/admin/speakers/history.csv?from=2026-11-09&to=2026-11-22&table=students');
    expect(csv.status).toBe(200);
    expect(String(csv.headers['content-type'])).toMatch(/^text\/csv/u);
    expect(String(csv.body)).toContain('Işık Yıldız');
    expect((await s.admin.get('/api/admin/speakers/history?from=2026-11-22&to=2026-11-09')).body.error.details.reason).toBe('BAD_PERIOD');
  });

  it('adds a section to the class report of the badge subject only', async () => {
    const { phone } = await newScorer();
    await award(phone, isik.id);
    const en = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-01&to=2026-11-30`));
    const sec = en.sections.find((x: any) => x.key === 'superSpeakers');
    expect(sec).toBeTruthy();
    expect(sec.metrics.find((m: any) => m.key === 'points').cell).toMatchObject({ v: 1 });
    const maths = await ok(s.teacherB.get(`/api/teacher/contexts/${s.ctxB.id}/report?from=2026-11-01&to=2026-11-30`));
    expect(maths.sections.find((x: any) => x.key === 'superSpeakers')).toBeUndefined();
  });

  it('awards the Super Speakers badges in the English class; voided points do not count and badges stay', async () => {
    const { phone } = await newScorer();
    // The English class starts its automatic badges from now on (S13c).
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievements/start`, { mode: 'fresh' }));
    const badges = () =>
      (env.db.$client.prepare('select achievement_id, revoked_at from student_achievements where student_id = ?').all(isik.id) as any[]).filter((r) => String(r.achievement_id).length > 0);
    const FIRST = defaultAchievementId('speakers.first');
    const P5 = defaultAchievementId('speakers.p5');
    const first = await award(phone, isik.id);
    expect(badges().map((b) => b.achievement_id)).toContain(FIRST);
    await ok(s.admin.post(`/api/admin/speakers/awards/${first.opId}/void`, { reason: 'Given by mistake' }));
    // Not taken back automatically (D-132).
    expect(badges().find((b) => b.achievement_id === FIRST)?.revoked_at).toBeNull();
    for (let i = 0; i < 4; i++) await award(phone, isik.id);
    // 4 live points (one voided): no 5-point badge yet.
    expect(badges().map((b) => b.achievement_id)).not.toContain(P5);
    await award(phone, isik.id);
    expect(badges().map((b) => b.achievement_id)).toContain(P5);
  });
});

describe('secrets never reach the logs (STU-6, D-128)', () => {
  beforeEach(enable);

  it('logs neither link tokens, session cookies nor pairing codes', async () => {
    const { link, phone } = await newScorer();
    const board = await newBoard();
    const { code } = await ok(phone.post('/api/scorer/pairing'));
    await ok(new Client(env).post('/api/scorer/pair', { code }));
    await award(phone, isik.id);
    await new Client(env).post('/api/scorer/session', { token: tokenOf(link.url) });
    // Everything the server logged at debug level, and the audit trail.
    const all = logs.join('\n') + JSON.stringify(env.db.$client.prepare('select * from audit_events').all());
    for (const secret of [tokenOf(link.url), tokenOf(board.link.url), phone.cookies.get('ccp')!, board.screen.cookies.get('ccb')!, code]) {
      expect(all).not.toContain(secret);
    }
  });
});
