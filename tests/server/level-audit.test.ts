/**
 * D-211 (GRP, ACC-9): the audit entry of a level change says who changed a level, for which student
 * and subject, and when, but never the level itself; a migration removes the value from past entries.
 * A level is for the subject's teacher only. Fictional names only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterEach(async () => env.app.close());

const rows = () => env.db.$client.prepare("select entity_id, before_json, after_json from audit_events where action = 'student.level_set' order by at, id").all() as Array<{ entity_id: string; before_json: string | null; after_json: string | null }>;

describe('level changes in the audit log (D-211)', () => {
  it('records who, which student and which subject, never the old or the new level', async () => {
    const elif = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Elif Yıldız' });
    const mert = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Mert Kaya' });
    const put = (levels: Array<{ studentId: string; level: string | null }>) => ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels }));
    const first = await put([{ studentId: elif.id, level: 'high' }, { studentId: mert.id, level: 'low' }]);
    // The teacher still gets the levels back; only the log leaves them out.
    expect(JSON.stringify(first)).toContain('high');
    await put([{ studentId: elif.id, level: 'medium' }]);
    await put([{ studentId: mert.id, level: null }]);

    const logged = rows();
    expect(logged.map((r) => r.entity_id)).toEqual([elif.id, mert.id, elif.id, mert.id]);
    for (const r of logged) {
      expect(r.before_json).toBeNull();
      expect(JSON.parse(r.after_json!)).toEqual({ subjectId: s.english.id });
    }
    // The administrator's Audit log shows the entries, without any level.
    const page = await ok(s.admin.get(`/api/admin/audit?entity=student&entityId=${elif.id}`));
    const entries = page.items.filter((i: any) => i.action === 'student.level_set');
    expect(entries).toHaveLength(2);
    expect(entries.every((i: any) => i.actorId === s.ayse.id)).toBe(true);
    for (const word of ['high', 'medium', 'low', '"level"']) expect(JSON.stringify(entries)).not.toContain(word);
  });

  it('the migration removes the level from past entries and leaves everything else as it was', () => {
    const insert = env.db.$client.prepare('insert into audit_events (id, at, actor_type, actor_id, action, entity, entity_id, before_json, after_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('old-1', 1, 'user', s.ayse.id, 'student.level_set', 'student', 'st-1', JSON.stringify({ subjectId: 'sub-1', level: 'low' }), JSON.stringify({ subjectId: 'sub-1', level: 'high' }));
    insert.run('old-2', 2, 'user', s.ayse.id, 'student.level_set', 'student', 'st-2', JSON.stringify({ subjectId: 'sub-1', level: null }), JSON.stringify({ subjectId: 'sub-1', level: 'medium' }));
    insert.run('other', 3, 'user', s.ayse.id, 'student.update', 'student', 'st-1', JSON.stringify({ level: 'kept' }), null);

    const file = fs.readdirSync(path.resolve(__dirname, '../../drizzle')).find((f) => f.endsWith('_sec_level_audit_values.sql'))!;
    const sql = fs.readFileSync(path.resolve(__dirname, '../../drizzle', file), 'utf8');
    env.db.$client.exec(sql);
    env.db.$client.exec(sql); // running it twice changes nothing more

    const after = env.db.$client.prepare('select id, before_json, after_json from audit_events where id in (?, ?, ?) order by id').all('old-1', 'old-2', 'other') as Array<{ id: string; before_json: string | null; after_json: string | null }>;
    expect(after.map((r) => [r.id, r.before_json && JSON.parse(r.before_json), r.after_json && JSON.parse(r.after_json)])).toEqual([
      ['old-1', { subjectId: 'sub-1' }, { subjectId: 'sub-1' }],
      ['old-2', { subjectId: 'sub-1' }, { subjectId: 'sub-1' }],
      ['other', { level: 'kept' }, null],
    ]);
  });
});
