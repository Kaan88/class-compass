/**
 * The AI tools privacy gate (S14h1, D-161), by iterating the tool, resource and prompt registries:
 * - classification: every MCP-exposed output schema marks every string field that could hold
 *   personal data with `pii()`;
 * - pseudonymous mode: marker student names (in every spelling) and marker student texts never appear
 *   in any tool result, resource or prompt; ids are `student-N`; teacher text has names replaced;
 * - both modes: private notes, homework notes, levels, photos, files and link tokens never appear;
 * - named mode: names appear and student text is wrapped as {untrustedText};
 * - aliases resolve only to the caller's own students.
 * Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lessons } from '../../src/server/db/schema.ts';
import { foldSameLength, NameScrubber, unmarkedStrings } from '../../src/server/modules/mcp/privacy.ts';
import { allTools, inputJsonSchema, type McpTool } from '../../src/server/modules/mcp/registry.ts';
import { allResources } from '../../src/server/modules/mcp/resources.ts';
import { PROMPTS } from '../../src/server/modules/mcp/prompts.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { endLesson, startLesson } from '../lesson-helpers.ts';
import { Mcp, makeToken, setAi } from '../mcp-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
// Marker names: unusual enough that any hit is a leak; Turkish letters on purpose.
const MAVI = { fullName: 'Mavimarker Kuzeyzed' };
const ILKAY = { fullName: 'İlkaymarker Şahinzed' };
const NAME_MARKERS = ['mavimarker', 'kuzeyzed', 'ilkaymarker', 'sahinzed'];
// Marker texts written by students.
const GOAL_TEXT = 'I will read Zorbuxtext stories every week.';
const REFLECTION = 'Reading Quillfernote books was fun today.';
const EVIDENCE = 'My list of Plimsolltext books for the term.';
const EVIDENCE_URL = 'https://example.org/plimsolllink';
const STUDENT_TEXT_MARKERS = ['zorbuxtext', 'quillfernote', 'plimsolltext', 'plimsolllink'];
// Things that never leave in either mode.
const NEVER_MARKERS = ['privnotemarker', 'hwnotemarker', 'marknotemarker', 'lvlmarker'];

let env: TestEnv;
let s: School;
let mavi: { id: string };
let ilkay: { id: string };
let linkToken: string;
let endedLessonId: string;
let runningLessonId: string;
let assignmentId: string;
let studentGoalId: string;
let teacherGoalId: string;

const lower = (x: string) => foldSameLength(x.normalize('NFC')).toLowerCase();

beforeAll(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  await setAi(s.admin, { mcpEnabled: true });
  mavi = await addStudent(s.teacherA, s.c3a.id, { fullName: MAVI.fullName });
  ilkay = await addStudent(s.teacherA, s.c3a.id, { fullName: ILKAY.fullName });
  for (const m of ['goals', 'homework']) await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/${m}`, { enabled: true }));

  // Student text (through the student's own link).
  const url = await linkUrl(s.teacherA, s.c3a.id, mavi.id);
  linkToken = url.slice(url.indexOf('#') + 1);
  const phone = await openLink(env, url);
  const goal = await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: GOAL_TEXT }));
  studentGoalId = goal.id;
  await ok(phone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: REFLECTION }));
  await ok(phone.post('/api/student/evidence', { subjectId: s.english.id, goalId: goal.id, kind: 'text', body: EVIDENCE }));
  await ok(phone.post('/api/student/evidence', { subjectId: s.english.id, goalId: goal.id, kind: 'link', url: EVIDENCE_URL }));

  // Teacher text that names the students, private notes, levels.
  const tgoal = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ilkay.id}/goals`, { categoryId: READING, text: 'Read one page aloud every day.' }));
  teacherGoalId = tgoal.id;
  await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${mavi.id}/feedback`, { goalId: goal.id, body: 'Well done Mavimarker, and İLKAYMARKER helped too.' }));
  await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${mavi.id}/private-notes`, { body: 'Privnotemarker about the family.' }));
  await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/levels`, { levels: [{ studentId: mavi.id, level: 'LVLMARKER' }] }));
  const hw = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/homework`, { title: 'Read with Kuzeyzed', dueOn: '2026-11-10', notes: 'Hwnotemarker' }));
  assignmentId = hw.id;
  await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: mavi.id, status: 'missing', note: 'Marknotemarker' }] }));

  // An ended lesson whose reflection names a student, and a running one.
  endedLessonId = await startLesson(s.teacherA, s.ctxA.id);
  await endLesson(s.teacherA, s.ctxA.id, endedLessonId);
  env.db.update(lessons).set({ reflectionJson: { rating: 4, note: 'Şahinzed read aloud beautifully.' } }).run();
  runningLessonId = await startLesson(s.teacherA, s.ctxA.id);
});
afterAll(async () => env.app.close());

/** Arguments for every tool, from the fixture ids (an unknown required field fails the test). */
function argsFor(t: McpTool, alias: (id: string) => string): Record<string, unknown> {
  const special: Record<string, Record<string, unknown>> = {
    create_homework: { contextId: s.ctxA.id, title: 'Spelling page 4', dueOn: '2026-11-12' },
    update_homework: { assignmentId, title: 'Read with Kuzeyzed again' },
    archive_homework: { assignmentId, archived: false },
    set_homework_marks: { assignmentId, changes: [{ studentId: alias(mavi.id), status: 'completed' }] },
    create_student_goal: { contextId: s.ctxA.id, studentId: alias(ilkay.id), categoryId: READING, text: 'Practise spelling every day.' },
    update_student_goal: { goalId: teacherGoalId, status: 'active' },
    add_goal_progress: { goalId: studentGoalId, body: 'Getting better every week.' },
    assess_goal: { goalId: studentGoalId, outcome: 'developing' },
    add_student_feedback: { contextId: s.ctxA.id, studentId: alias(mavi.id), body: 'Lovely reading today.' },
    create_goal_category: { contextId: s.ctxA.id, name: { en: 'Drama club' } },
    create_goal_preset: { contextId: s.ctxA.id, categoryId: READING, text: { en: 'I can read a short story aloud.' } },
    create_sentence_starter: { contextId: s.ctxA.id, kind: 'goal', text: { en: 'I want to get better at ___.' } },
    set_class_module: { contextId: s.ctxA.id, module: 'goals', enabled: true },
    set_topic_plan: { contextId: s.ctxA.id, plan: {} },
    classroom_command: { command: 'attendance.markAllPresent', contextId: s.ctxA.id, lessonId: runningLessonId },
    attendance_history: { classId: s.c3a.id, date: '2026-11-09' },
    lesson_summary: { lessonId: endedLessonId },
    student_timeline: { contextId: s.ctxA.id, studentId: alias(mavi.id), from: '2026-09-01', to: '2026-11-30' },
    student_summary: { contextId: s.ctxA.id, studentId: alias(mavi.id) },
    student_goals: { contextId: s.ctxA.id, studentId: alias(mavi.id) },
    student_report_contexts: { studentId: alias(mavi.id) },
    homework_check: { assignmentId },
    validate_theme: { package: '{}' },
    import_theme_draft: { package: '{}' },
    export_theme: { key: 'no-such-theme' },
    update_school_settings: { weatherEnabled: true },
    set_module_policy: { module: 'goals', availability: 'enabled' },
  };
  if (special[t.name]) return special[t.name]!;
  const schema = inputJsonSchema(t) as { properties?: Record<string, unknown>; required?: string[] };
  const ids: Record<string, string> = { contextId: s.ctxA.id, classId: s.c3a.id, studentId: alias(mavi.id), lessonId: endedLessonId, assignmentId, goalId: studentGoalId };
  const args: Record<string, unknown> = {};
  for (const k of schema.required ?? []) {
    if (!(k in ids)) throw new Error(`no fixture for ${t.name}.${k}`);
    args[k] = ids[k];
  }
  return args;
}

const visibleTo = (role: 'teacher' | 'admin') => (t: { role: string }) => t.role === 'any' || t.role === role;

/** Calls every tool, reads every resource and gets every prompt; returns all the text that left. */
async function everything(c: Mcp, role: 'teacher' | 'admin'): Promise<{ texts: Map<string, string>; failed: string[] }> {
  await c.init();
  const texts = new Map<string, string>();
  const failed: string[] = [];
  for (const t of allTools().filter(visibleTo(role))) {
    // Real ids as input (aliases are tested on their own below).
    const r = await c.call(t.name, argsFor(t, (id) => id));
    texts.set(`tool ${t.name}`, r.text);
    // Reads must succeed; writes and the theme tools may refuse fictional input, but are scanned too.
    if (r.isError && t.readOnly && !['export_theme', 'validate_theme'].includes(t.name)) failed.push(`${t.name}: ${r.text}`);
  }
  for (const r of (await c.rpc('resources/list')).result.resources as Array<{ uri: string }>) {
    texts.set(`resource ${r.uri}`, (await c.rpc('resources/read', { uri: r.uri })).result.contents[0].text);
  }
  for (const p of (await c.rpc('prompts/list')).result.prompts as Array<{ name: string; arguments: Array<{ name: string }> }>) {
    const args = Object.fromEntries(p.arguments.map((a) => [a.name, a.name === 'contextId' ? s.ctxA.id : `about ${MAVI.fullName}`]));
    texts.set(`prompt ${p.name}`, JSON.stringify((await c.rpc('prompts/get', { name: p.name, arguments: args })).result));
  }
  return { texts, failed };
}

describe('classification (D-161)', () => {
  it('every MCP-exposed output marks every string that could hold personal data', () => {
    const problems = [...allTools().map((t) => [`tool ${t.name}`, t.output] as const), ...allResources().map((r) => [`resource ${r.uri}`, r.output] as const)].flatMap(([name, schema]) =>
      unmarkedStrings(schema).map((p) => `${name}: ${p}`),
    );
    expect(problems).toEqual([]);
  });

  it('the registry has the generated and hand-written tools of the brief, and nothing that must never be exposed', () => {
    const tools = allTools();
    expect(tools.length).toBeGreaterThanOrEqual(30);
    for (const name of ['class_overview', 'student_summary', 'create_goal_preset', 'create_sentence_starter', 'theme_schema', 'validate_theme', 'import_theme_draft', 'export_theme']) expect(tools.map((t) => t.name)).toContain(name);
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(60);
      if (t.endpoint) {
        expect(['classroom', 'teacher', 'admin']).toContain(t.endpoint.access);
        expect(t.endpoint.path).not.toMatch(/export|erase|backup|maintenance|student-links|\/link|files|password|pin|invite|private-notes|levels|secret|scorer|speakers/u);
      }
    }
    expect(PROMPTS.map((p) => p.name).sort()).toEqual(['design_theme', 'goal_presets', 'topic_plan', 'weekly_summary']);
  });

  it('matches names Turkish-aware, whole words only, parts only when capitalised', () => {
    const sc = new NameScrubber([{ id: 'a', fullName: 'İlkay Şahin', givenNames: null, familyName: null }, { id: 'b', fullName: 'Can Ak', givenNames: null, familyName: null }]);
    const label = (id: string) => `<${id}>`;
    expect(sc.scrub('ILKAY ŞAHİN came. ilkay sahin too. Ilkay’ın kitabı.', label)).toBe('<a> came. <a> too. <a>’ın kitabı.');
    expect(sc.scrub('We can read. Can read. Canan read.', label)).toBe('We can read. <b> read. Canan read.');
  });
});

describe('pseudonymous mode (D-161)', () => {
  it('no marker name or student text leaves through any tool, resource or prompt', async () => {
    const teacher = new Mcp(env, (await makeToken(s.teacherA, { scopes: ['classes:read', 'reports:read', 'goals:read', 'goals:write', 'homework:write', 'classroom:command', 'settings:write'] })).secret);
    const admin = new Mcp(env, (await makeToken(s.admin, { scopes: ['school:read', 'settings:admin', 'themes:write'] })).secret);
    const a = await everything(teacher, 'teacher');
    const b = await everything(admin, 'admin');
    expect([...a.failed, ...b.failed]).toEqual([]);
    const called = new Set([...a.texts.keys(), ...b.texts.keys()].filter((k) => k.startsWith('tool ')).map((k) => k.slice(5)));
    expect(allTools().map((t) => t.name).filter((n) => !called.has(n))).toEqual([]);
    const leaks: string[] = [];
    for (const [where, text] of [...a.texts, ...b.texts]) {
      const l = lower(text);
      for (const m of [...NAME_MARKERS, ...STUDENT_TEXT_MARKERS, ...NEVER_MARKERS]) if (l.includes(m)) leaks.push(`${where}: ${m}`);
      if (text.includes(mavi.id) || text.includes(ilkay.id)) leaks.push(`${where}: a student id`);
      if (text.includes(linkToken)) leaks.push(`${where}: a link token`);
      if (/photoUrl|\/api\/files\//u.test(text)) leaks.push(`${where}: a photo or file`);
    }
    expect(leaks).toEqual([]);
    // Names in teacher text became pseudonyms, and the student's own words were withheld.
    const goals = JSON.parse(a.texts.get('tool student_goals')!);
    expect(goals.student.fullName).toMatch(/^Student \d+$/u);
    expect(goals.student.id).toMatch(/^student-\d+$/u);
    expect(goals.goals.find((g: { authorType: string }) => g.authorType === 'student').text).toBe('[withheld: student text]');
    expect(goals.feedback.some((f: { body: string }) => /Well done Student \d+, and Student \d+ helped too\./u.test(f.body))).toBe(true);
    expect(goals.privateNotes).toBeUndefined();
    expect(goals.evidence.every((e: Record<string, unknown>) => !('file' in e))).toBe(true);
    const summary = JSON.parse(a.texts.get('tool lesson_summary')!);
    expect(summary.reflection.note).toMatch(/^Student \d+ read aloud beautifully\.$/u);
    // The same student keeps the same pseudonym across calls of one token.
    expect(JSON.parse(a.texts.get('tool student_summary')!).student.fullName).toBe(goals.student.fullName);
  });

  it('aliases resolve only to the caller’s own students', async () => {
    const t = (await makeToken(s.teacherA, { scopes: ['classes:read', 'reports:read', 'goals:read'], name: 'Alias A' })).secret;
    const a = new Mcp(env, t);
    await a.init();
    const roster = await a.call('class_roster', { contextId: s.ctxA.id });
    const alias = (roster.data.students as Array<{ id: string }>)[0]!.id;
    expect(alias).toMatch(/^student-\d+$/u);
    expect((await a.call('student_timeline', { contextId: s.ctxA.id, studentId: alias })).isError).toBe(false);
    // Another teacher's token with the same number reaches nothing of 3-A.
    const b = new Mcp(env, (await makeToken(s.teacherB, { scopes: ['classes:read', 'reports:read', 'goals:read'], name: 'Alias B' })).secret);
    await b.init();
    const other = await b.call('student_report_contexts', { studentId: alias });
    expect(other.isError || other.data.contexts.length === 0).toBe(true);
  });
});

describe('named mode (D-161)', () => {
  it('names leave, student text is wrapped, notes, levels and files still never leave', async () => {
    await setAi(s.admin, { aiStudentDataAllowed: true });
    try {
      const c = new Mcp(env, (await makeToken(s.teacherA, { scopes: ['classes:read', 'reports:read', 'goals:read'], privacy: 'named', name: 'Named' })).secret);
      const { texts } = await everything(c, 'teacher');
      const goals = JSON.parse(texts.get('tool student_goals')!);
      expect(goals.student.fullName).toBe(MAVI.fullName);
      expect(goals.goals.find((g: { authorType: string }) => g.authorType === 'student').text).toEqual({ untrustedText: GOAL_TEXT });
      expect(goals.evidence.find((e: { kind: string }) => e.kind === 'text').body).toEqual({ untrustedText: EVIDENCE });
      for (const [where, text] of texts) for (const m of NEVER_MARKERS) expect(lower(text).includes(m), `${where}: ${m}`).toBe(false);
      for (const [where, text] of texts) expect(text.includes(linkToken), where).toBe(false);
      // Switching student data off narrows the same token to pseudonyms at once.
      await setAi(s.admin, { aiStudentDataAllowed: false });
      const again = await c.call('student_goals', { contextId: s.ctxA.id, studentId: mavi.id });
      expect(again.data.student.fullName).toMatch(/^Student \d+$/u);
    } finally {
      await setAi(s.admin, { aiStudentDataAllowed: false });
    }
  });
});
