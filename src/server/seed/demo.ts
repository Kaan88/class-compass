/**
 * Fictional demo school (OPS-5, ENG-4). Every name here is invented; no real data. Passwords are
 * random per run and returned to the caller to print once — nothing is hard-coded.
 *
 * Refuses in production, and refuses when the database already has data unless `force` is set
 * AND the database holds no school data (only accounts, e.g. an admin created with admin:create).
 */
import { eq, sql } from 'drizzle-orm';
import { schoolYearFor } from '../../domain/dates.ts';
import { tx } from '../db/client.ts';
import { classes, schoolSettings, schoolYears, students, subjects, teachingContexts, terms, users } from '../db/schema.ts';
import { audit } from '../lib/audit.ts';
import type { Actor, AppDeps } from '../lib/context.ts';
import { newId, randomToken } from '../lib/crypto.ts';
import { createUser, normaliseLogin } from '../modules/auth/service.ts';
import { ensureSchoolDefaults } from '../modules/school/defaults.ts';
import { getSchoolSettings, type ClassRow } from '../modules/school/policy.ts';
import { createStudentInClass } from '../modules/students/service.ts';

const SYSTEM: Actor = { type: 'system', id: null };

const GIVEN = [
  'Ayşe', 'Elif', 'Zeynep', 'Ömer', 'Mehmet', 'Yiğit', 'Çınar', 'Ilgın', 'Irmak', 'İpek', 'İbrahim', 'Şevval', 'Şule', 'Ümit',
  'Öykü', 'Doğa', 'Ege', 'Göktuğ', 'Kağan', 'Barış', 'Defne', 'Asya', 'Eylül', 'Gökçe', 'Işıl', 'Nazlı', 'Ozan', 'Selin',
  'Arda', 'Berk', 'Cansu', 'Duru', 'Efe', 'Emir', 'Ece', 'Hira', 'Kerem', 'Mert', 'Nehir', 'Poyraz', 'Sarp', 'Toprak', 'Yağmur',
];
const GIVEN_MULTI = ['Ayşe Nur', 'Mehmet Ali', 'Elif Su', 'Ali Rıza', 'Zeynep İrem', 'Ahmet Çağan', 'Fatma Gül', 'Ömer Faruk', 'Beren Işık', 'Hüseyin Efe'];
const FAMILY = [
  'Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan',
  'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Güneş', 'Akgül', 'Uğurlu', 'Işık', 'Ünal', 'Bulut', 'Tekin',
  'Gündoğdu', 'Ergün', 'Karataş', 'İnce', 'Çakır', 'Öner', 'Sağlam',
];
const FAMILY_MULTI = ['Kara Yılmaz', 'Öztürk Şen', 'Demir Uçar', 'Aydın Güçlü'];
const ENGLISH = [
  ['Oliver', 'Smith'],
  ['Emma', 'Clarke'],
  ['Liam', 'O’Brien'],
  ['Sophie', 'Turner'],
  ['Noah', 'Williams'],
  ['Mia', 'Johnson-Kaya'],
  ['Jack', 'Taylor'],
  ['Isla', 'Brown'],
] as const;

/** Small deterministic PRNG so the demo looks the same on every machine. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoName {
  fullName: string;
  givenNames: string | null;
  familyName: string | null;
}

/** `count` fictional names, unique school-wide, mixing multi-part Turkish names and some English names. */
export function demoNames(count: number, rand: () => number, used: Set<string>): DemoName[] {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const out: DemoName[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 10_000) {
    const r = rand();
    let given: string;
    let family: string;
    if (r < 0.1) [given, family] = pick(ENGLISH);
    else {
      given = r < 0.3 ? pick(GIVEN_MULTI) : pick(GIVEN);
      family = r > 0.9 ? pick(FAMILY_MULTI) : pick(FAMILY);
    }
    const fullName = `${given} ${family}`;
    if (used.has(fullName)) continue;
    used.add(fullName);
    // Some records carry only a full name (as typed by a teacher) to exercise that path.
    const split = rand() > 0.15;
    out.push({ fullName, givenNames: split ? given : null, familyName: split ? family : null });
  }
  return out;
}

export interface DemoAccount {
  login: string;
  role: 'admin' | 'teacher';
  displayName: string;
  password: string;
}

export interface DemoResult {
  accounts: DemoAccount[];
  schoolYear: string;
  classes: Array<{ name: string; students: number }>;
}

export class SeedRefused extends Error {}

const count = (deps: AppDeps, table: typeof users | typeof students | typeof classes | typeof schoolYears | typeof subjects) =>
  deps.db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;

export async function seedDemo(deps: AppDeps, opts: { force?: boolean } = {}): Promise<DemoResult> {
  if (deps.config.isProd) throw new SeedRefused('Refusing to seed demo data when NODE_ENV=production.');
  ensureSchoolDefaults(deps);
  const schoolData = count(deps, students) + count(deps, classes) + count(deps, schoolYears) + count(deps, subjects);
  const accounts = count(deps, users);
  if (schoolData > 0) throw new SeedRefused('The database already contains school data. The demo seed only runs on an empty database.');
  if (accounts > 0 && !opts.force) {
    throw new SeedRefused('The database already has accounts. Re-run with --force-demo to add the demo school next to them (no school data may exist).');
  }
  const demoAccounts: Array<Omit<DemoAccount, 'password'> & { email: string }> = [
    { login: 'admin', role: 'admin', displayName: 'Demo Administrator', email: 'admin@demo.example' },
    { login: 'english', role: 'teacher', displayName: 'Deniz Akın (English)', email: 'english@demo.example' },
    { login: 'classroom3a', role: 'teacher', displayName: 'Sevgi Toprak (3-A)', email: 'classroom3a@demo.example' },
  ];
  for (const a of demoAccounts) {
    if (deps.db.select({ id: users.id }).from(users).where(eq(users.login, normaliseLogin(a.login))).get()) {
      throw new SeedRefused(`An account with login "${a.login}" already exists; the demo seed will not touch it.`);
    }
  }

  const now = deps.now();
  const created: DemoAccount[] = [];
  const ids: Record<string, string> = {};
  for (const a of demoAccounts) {
    const password = randomToken(12);
    const u = await createUser(deps.db, { login: a.login, displayName: a.displayName, role: a.role, password, email: a.email }, SYSTEM, now);
    ids[a.login] = u.id;
    created.push({ login: a.login, role: a.role, displayName: a.displayName, password });
  }

  return tx(deps.db, () => {
    deps.db.update(schoolSettings).set({ schoolName: 'Demo Primary School', updatedAt: now }).where(eq(schoolSettings.id, 1)).run();
    const tz = getSchoolSettings(deps.db).timezone;
    const span = schoolYearFor(now, tz);
    const start = Number(span.startsOn.slice(0, 4));
    const yearId = newId();
    deps.db.insert(schoolYears).values({ id: yearId, ...span, archivedAt: null, createdAt: now, updatedAt: now }).run();
    deps.db
      .insert(terms)
      .values([
        { id: newId(), schoolYearId: yearId, name: { en: 'Term 1', tr: '1. Dönem' }, startsOn: span.startsOn, endsOn: `${start + 1}-01-23`, createdAt: now, updatedAt: now },
        { id: newId(), schoolYearId: yearId, name: { en: 'Term 2', tr: '2. Dönem' }, startsOn: `${start + 1}-02-09`, endsOn: span.endsOn, createdAt: now, updatedAt: now },
      ])
      .run();

    const subj: Record<string, string> = {};
    for (const [key, name] of [
      ['english', { en: 'English', tr: 'İngilizce' }],
      ['maths', { en: 'Mathematics', tr: 'Matematik' }],
      ['science', { en: 'Science', tr: 'Fen Bilimleri' }],
    ] as const) {
      subj[key] = newId();
      deps.db.insert(subjects).values({ id: subj[key]!, name, archivedAt: null, createdAt: now, updatedAt: now }).run();
    }

    const classSpecs = [
      { name: '3-A', grade: 3, theme: 'explorer', size: 19 },
      { name: '3-B', grade: 3, theme: 'animals', size: 20 },
      { name: '4-C', grade: 4, theme: 'classroom', size: 34 },
      { name: '2-D', grade: 2, theme: 'explorer', size: 3 },
    ] as const;
    const rand = mulberry32(20261107);
    const used = new Set<string>();
    let nextNumber = 1001;
    const classRows: Record<string, ClassRow> = {};
    for (const spec of classSpecs) {
      const row: ClassRow = {
        id: newId(),
        schoolYearId: yearId,
        name: spec.name,
        grade: spec.grade,
        theme: spec.theme,
        timezone: null,
        soundsEnabled: true,
        animationsEnabled: true,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      deps.db.insert(classes).values(row).run();
      classRows[spec.name] = row;
      demoNames(spec.size, rand, used).forEach((n, i) => {
        const studentNumber = i % 7 === 3 ? null : String(nextNumber++);
        createStudentInClass(deps, SYSTEM, row, { ...n, studentNumber, allowDuplicateName: true }, { visibleClassIds: 'all', fromDate: span.startsOn });
      });
    }

    const assign = (teacher: string, cls: string, subject: string) =>
      deps.db
        .insert(teachingContexts)
        .values({ id: newId(), teacherId: ids[teacher]!, classId: classRows[cls]!.id, subjectId: subj[subject]!, activeFrom: now, endedAt: null, createdAt: now })
        .run();
    for (const c of Object.keys(classRows)) assign('english', c, 'english');
    for (const s of ['english', 'maths', 'science']) assign('classroom3a', '3-A', s);

    audit(deps.db, SYSTEM, { action: 'demo.seed', entity: 'school', after: { schoolYear: span.name, classes: classSpecs.map((c) => c.name) } }, now);
    return { accounts: created, schoolYear: span.name, classes: classSpecs.map((c) => ({ name: c.name, students: c.size })) };
  });
}
