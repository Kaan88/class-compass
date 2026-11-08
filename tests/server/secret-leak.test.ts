/**
 * Secret Student secrecy leak scan (SEC-3, STU-5, ENG-3 "Secret Student secrecy", D-064).
 *
 * After a draw, every GET endpoint registered on the server is called as the teacher and as the
 * administrator (path parameters filled with real ids), together with the command answers, the audit
 * API and everything the server logged. Two checks:
 *  1. Differential: the chosen students are swapped for others directly in the database; every
 *     response (body + ETag) must be byte-identical before and after, i.e. nothing a client can
 *     read depends on WHO was chosen.
 *  2. Direct scan: command answers, the audit API, the lesson state's secret part and the logs never
 *     contain the chosen students' ids or names.
 * After the reveal the same differential must DETECT the change, proving the scan can see names.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Endpoint } from '../../src/shared/contracts/define.ts';
import { registeredEndpoints } from '../../src/server/lib/http.ts';
import type { Client } from '../helpers.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let logs: string[];
let kids: Array<{ id: string; fullName: string }>;

beforeEach(async () => {
  logs = [];
  env = await makeEnv({}, { logStream: { write: (line: string) => void logs.push(line) } });
  s = await buildSchool(env);
  kids = [];
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız', 'Işıl Çınar', 'Oliver Clarke', 'Zeynep Aksoy', 'Mert Doğan', 'Defne Şahin', 'Kerem Öztürk']) {
    kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
  }
});
afterEach(async () => env.app.close());

function uniqueGets(): Endpoint[] {
  const seen = new Set<string>();
  return registeredEndpoints.filter((e) => {
    const k = `${e.method} ${e.path}`;
    if (e.method !== 'GET' || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function snapshot(clients: Array<[string, Client]>, params: Record<string, string>) {
  const out = new Map<string, string>();
  for (const e of uniqueGets()) {
    const url = e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => params[k] ?? '0190f0f0-0000-7000-8000-000000000000');
    for (const [who, c] of clients) {
      const r = await c.get(url);
      // The host disk's free space (maintenance page) changes with anything else running on the machine.
      out.set(`${who} GET ${url}`, `${r.status} ${String(r.headers.etag ?? '')} ${JSON.stringify(r.body).replace(/"freeBytes":\d+/gu, '"freeBytes":0')}`);
    }
  }
  return out;
}

const chosenRows = (lessonId: string) =>
  env.db.$client.prepare("select s.id, s.student_id studentId from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ? and r.status = 'live' and s.status = 'sealed' order by s.id").all(lessonId) as Array<{ id: string; studentId: string }>;

describe('pre-reveal secrecy (SEC-3)', () => {
  it('no endpoint, command answer, audit entry or log line depends on who was chosen', async () => {
    const lessonId = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/secret/settings`, { count: 3 }));
    const drawn = await cmd(s.teacherA, 'secret.draw', { contextId: s.ctxA.id, lessonId });
    const again = await cmd(s.teacherA, 'secret.draw', { contextId: s.ctxA.id, lessonId });
    const chosen = chosenRows(lessonId);
    expect(chosen).toHaveLength(3);
    const chosenIds = chosen.map((c) => c.studentId);
    const others = kids.map((k) => k.id).filter((id) => !chosenIds.includes(id));
    const counter = env.db.$client.prepare('select id from counters limit 1').get() as { id: string } | undefined;
    const params: Record<string, string> = {
      contextId: s.ctxA.id,
      classId: s.c3a.id,
      lessonId,
      studentId: chosenIds[0]!,
      yearId: s.year.id,
      subjectId: s.english.id,
      userId: s.ayse.id,
      counterId: counter?.id ?? 'none',
      templateId: 'builtin:default',
      module: 'secretStudents',
    };
    const clients: Array<[string, Client]> = [
      ['teacher', s.teacherA],
      ['admin', s.admin],
      ['other-teacher', s.teacherB],
    ];

    // A chosen student and a non-chosen student are marked absent: the answers have the same shape.
    const absentChosen = await cmd(s.teacherA, 'attendance.setLessonException', { contextId: s.ctxA.id, lessonId, studentId: chosenIds[0], status: 'absent' });
    const absentOther = await cmd(s.teacherA, 'attendance.setLessonException', { contextId: s.ctxA.id, lessonId, studentId: others[0], status: 'absent' });
    const norm = (r: any) => JSON.stringify({ ...r, opId: 'x', result: { ...r.result, studentId: 'x' } });
    expect(norm(absentChosen)).toBe(norm(absentOther));

    await snapshot(clients, params); // warm-up: reads that create defaults (counters, assistant plan) run once
    const before = await snapshot(clients, params);

    // Swap the sealed selections for different students (same count), as if others had been chosen.
    const sealedNow = chosenRows(lessonId);
    const swapTo = kids.map((k) => k.id).filter((id) => !sealedNow.some((c) => c.studentId === id) && id !== others[0] && id !== chosenIds[0]);
    expect(swapTo.length).toBeGreaterThanOrEqual(sealedNow.length);
    sealedNow.forEach((row, i) => env.db.$client.prepare('update secret_selections set student_id = ? where id = ?').run(swapTo[i], row.id));
    const after = await snapshot(clients, params);

    const differing = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(differing).toEqual([]);
    expect(before.size).toBeGreaterThan(60);
    // The scan reached the interesting endpoints with real ids (not just 4xx answers).
    for (const k of [
      `teacher GET /api/classroom/contexts/${s.ctxA.id}/lesson`,
      `teacher GET /api/classroom/lessons/${lessonId}/secret`,
      `teacher GET /api/teacher/contexts/${s.ctxA.id}/secret/history`,
      `teacher GET /api/classroom/contexts/${s.ctxA.id}/roster`,
      `teacher GET /api/teacher/classes/${s.c3a.id}/attendance`,
      `teacher GET /api/teacher/contexts/${s.ctxA.id}/assistant/plan`,
      `admin GET /api/admin/audit`,
      `admin GET /api/admin/students/${chosenIds[0]}`,
    ]) {
      expect(before.get(k)?.slice(0, 3), k).toBe('200');
    }

    // Direct scan of channels that must never carry any chosen identity before the reveal.
    const secretIdentities = [...chosenIds, ...sealedNow.map((r) => r.studentId)];
    const names = kids.filter((k) => secretIdentities.includes(k.id)).map((k) => k.fullName);
    const auditApi = await ok(s.admin.get('/api/admin/audit?pageSize=200'));
    const state = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`));
    const secretAudit = env.db.$client.prepare("select action, before_json, after_json from audit_events where action like 'secret.%'").all();
    const scanned = JSON.stringify([drawn, again, auditApi.items.filter((e: any) => String(e.action).startsWith('secret.')), state.secret, secretAudit, logs]);
    for (const id of secretIdentities) expect(scanned).not.toContain(id);
    for (const n of names) expect(scanned).not.toContain(n);

    // Sanity: after the reveal the very same scan sees the names.
    const rv = await cmd(s.teacherA, 'secret.reveal', { contextId: s.ctxA.id, lessonId });
    expect(rv.ok).toBe(true);
    const revealed = await snapshot(clients, params);
    expect([...revealed.keys()].some((k) => revealed.get(k) !== after.get(k))).toBe(true);
    expect(JSON.stringify(rv.result)).toContain(swapTo[0]!);
  }, 60_000);
});
