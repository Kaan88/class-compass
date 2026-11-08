/**
 * Feedback round 1b, items 10–14 (S13b2). Fictional data only; uploads land in a temporary folder.
 * - 10 (D-114): private teacher notes are in the FULL admin export only; still admin-only; the
 *   per-student export keeps the count; teachers, students and admin reports never see them.
 * - 11 (D-116): default categories and presets can be archived per teacher (own classes only) or
 *   school-wide by an admin, and restored; existing goals keep their label snapshot (DAT-6).
 * - 14b (D-117): the student pages can have their own language mode; null = same as the class.
 * - 13 / 14c (D-119): teachers add evidence for a student; documents (ODT, PPTX, TXT) are accepted
 *   and sniffed; audio tags are removed (MP3, WAV, MP4, Ogg Opus, WebM); HEIC gets a clear reason;
 *   photo and audio flags still decide.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { oggCrc, stripAudioMetadata } from '../../src/server/modules/files/audioMeta.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const READ_WEEKLY = '00000000-0000-7000-8000-00000000d011';
const WRITING = '00000000-0000-7000-8000-00000000c002';
const NOTE_MARKER = 'PRIVATE-NOTE-otter-lantern-5521';
const TAG_MARKER = 'Ada Kurgu at Ankara Kizilay';

let env: TestEnv;
let s: School;
let root: string;
let ada: { id: string; fullName: string };
let cem: { id: string; fullName: string };
let adaPhone: Client;
let cemPhone: Client;

const setMedia = (module: string, on: boolean) => ok(s.admin.put(`/api/admin/module-policies/${module}`, { availability: on ? 'enabled' : 'disabled' }));
const send = (c: Client, url: string, data: Buffer, filename: string, type: string) => {
  const m = multipart(data, filename, type);
  return c.req('POST', url, m.body, m.headers);
};
const goalsOf = (page: any) => page.subjects.find((x: any) => x.name.en === 'English')?.sections.find((x: any) => x.key === 'goals')?.data;

function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString('utf8');
    const data = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    i += 30 + nlen + xlen + csize;
  }
  return out;
}
const download = async (c: Client, token: string) =>
  (await env.app.inject({ method: 'GET', url: `/api/admin/exports/${token}`, headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })).rawPayload;
const rawFile = async (c: Client, url: string) => (await env.app.inject({ method: 'GET', url, headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })).rawPayload;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-s13b2-'));
  env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr'), DATA_DIR: root });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  cem = await ok(s.admin.post('/api/admin/students', { classId: s.c3b.id, fullName: 'Cem Kurgu' }));
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  // 3-B also learns English (with Mehmet), so a second teacher's classes can be compared.
  await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3b.id, subjectId: s.english.id }));
  cemPhone = await openLink(env, await linkUrl(s.teacherB, s.c3b.id, cem.id));
});
afterEach(async () => {
  await env.app.close();
  await fsp.rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- item 10
describe('private teacher notes in the full admin export (item 10, D-114, GOL-6)', () => {
  it('the full export has the notes with author, student and subject; it is admin-only; the per-student export keeps only the count', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/private-notes`, { body: `${NOTE_MARKER} reads slowly` }));
    expect((await s.teacherA.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: false })).status).toBe(403);
    const ready = await ok(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: false }));
    const entries = unzip(await download(s.admin, ready.token));
    const csv = entries['tables/private_teacher_notes.csv']!.toString('utf8');
    expect(csv.split('\r\n')[0]).toBe('﻿id,teacher_id,author_name,student_id,student_name,subject_id,subject_name_en,subject_name_tr,body,created_at,updated_at,deleted_at');
    expect(csv).toContain(NOTE_MARKER);
    expect(csv).toContain('Test ayse.teacher');
    expect(csv).toContain('Ada Kurgu');
    expect(csv).toContain('English');
    const manifest = JSON.parse(entries['manifest.json']!.toString('utf8'));
    expect(manifest.privateNotesIncluded).toBe(1);
    expect(manifest.privateNotesNotIncluded).toBeUndefined();
    // Only the one notes table carries the note text.
    const carriers = Object.entries(entries).filter(([, v]) => v.includes(Buffer.from(NOTE_MARKER))).map(([n]) => n);
    expect(carriers).toEqual(['tables/private_teacher_notes.csv']);

    const one = await ok(s.admin.post(`/api/admin/students/${ada.id}/export`));
    const perStudent = unzip(await download(s.admin, one.token));
    expect(Object.values(perStudent).some((v) => v.includes(Buffer.from(NOTE_MARKER)))).toBe(false);
    expect(JSON.parse(perStudent['manifest.json']!.toString('utf8')).privateNotesNotIncluded).toBe(1);
  });

  it('notes stay invisible to other teachers, students and admin reports', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/private-notes`, { body: NOTE_MARKER }));
    const ozgeCtx = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.english.id }));
    const other = await ok(s.teacherB.get(`/api/teacher/contexts/${ozgeCtx.id}/students/${ada.id}/goals`));
    expect(JSON.stringify(other)).not.toContain(NOTE_MARKER);
    expect(JSON.stringify(await ok(adaPhone.get('/api/student/page')))).not.toContain(NOTE_MARKER);
    const report = await s.admin.get(`/api/admin/contexts/${s.ctxA.id}/report?from=2026-09-01&to=2026-12-31`);
    expect(JSON.stringify(report.body)).not.toContain(NOTE_MARKER);
  });
});

// ---------------------------------------------------------------- item 11
describe('archivable default presets and categories (item 11, D-116)', () => {
  it('teacher A hides a default for their own classes only; B and B’s students still see it; restore brings it back', async () => {
    const existing = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, presetId: READ_WEEKLY }));
    const hidden = await ok(s.teacherA.patch(`/api/teacher/goal-presets/${READ_WEEKLY}`, { archived: true }));
    expect(hidden).toMatchObject({ id: READ_WEEKLY, custom: false, archived: true, schoolArchived: false });
    // Teachers cannot rename a default.
    expect((await s.teacherA.patch(`/api/teacher/goal-presets/${READ_WEEKLY}`, { text: { en: 'Changed' } })).body.error.details.reason).toBe('DEFAULT_ITEM_READ_ONLY');

    const libA = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goal-library`));
    expect(libA.presets.find((p: any) => p.id === READ_WEEKLY).archived).toBe(true);
    const adaGoals = goalsOf(await ok(adaPhone.get('/api/student/page')));
    expect(adaGoals.presets.map((p: any) => p.id)).not.toContain(READ_WEEKLY);
    expect((await adaPhone.post('/api/student/goals', { subjectId: s.english.id, presetId: READ_WEEKLY })).status).toBe(404);
    // The goal set before keeps its words (DAT-6).
    expect(adaGoals.goals.find((g: any) => g.id === existing.id).presetText.en).toBe('I will read a short book every week.');

    const ctxB = (await ok(s.teacherB.get('/api/teacher/contexts'))).contexts.find((c: any) => c.classId === s.c3b.id && c.subjectName.en === 'English');
    const libB = await ok(s.teacherB.get(`/api/teacher/contexts/${ctxB.id}/goal-library`));
    expect(libB.presets.find((p: any) => p.id === READ_WEEKLY).archived).toBe(false);
    expect(goalsOf(await ok(cemPhone.get('/api/student/page'))).presets.map((p: any) => p.id)).toContain(READ_WEEKLY);

    // A hidden default category hides its presets for A's students too.
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${WRITING}`, { archived: true }));
    const after = goalsOf(await ok(adaPhone.get('/api/student/page')));
    expect(after.categories.map((c: any) => c.id)).not.toContain(WRITING);
    expect(after.presets.some((p: any) => p.categoryId === WRITING)).toBe(false);
    expect((await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: WRITING, text: 'I will write a story.' })).status).toBe(404);

    await ok(s.teacherA.patch(`/api/teacher/goal-presets/${READ_WEEKLY}`, { archived: false }));
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${WRITING}`, { archived: false }));
    const restored = goalsOf(await ok(adaPhone.get('/api/student/page')));
    expect(restored.presets.map((p: any) => p.id)).toContain(READ_WEEKLY);
    expect(restored.categories.map((c: any) => c.id)).toContain(WRITING);
  });

  it('an admin archives a default school-wide (everyone), only an admin restores it; audited', async () => {
    expect((await s.teacherA.put(`/api/admin/goal-defaults/preset/${READ_WEEKLY}`, { archived: true })).status).toBe(403);
    const lib = await ok(s.admin.put(`/api/admin/goal-defaults/preset/${READ_WEEKLY}`, { archived: true }));
    expect(lib.presets.find((p: any) => p.id === READ_WEEKLY)).toMatchObject({ archived: true, schoolArchived: true });
    for (const phone of [adaPhone, cemPhone]) expect(goalsOf(await ok(phone.get('/api/student/page'))).presets.map((p: any) => p.id)).not.toContain(READ_WEEKLY);
    const libA = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goal-library`));
    expect(libA.presets.find((p: any) => p.id === READ_WEEKLY)).toMatchObject({ archived: true, schoolArchived: true });
    // A teacher's "restore" only clears their own hide: the school-wide archive stays.
    await ok(s.teacherA.patch(`/api/teacher/goal-presets/${READ_WEEKLY}`, { archived: false }));
    expect(goalsOf(await ok(adaPhone.get('/api/student/page'))).presets.map((p: any) => p.id)).not.toContain(READ_WEEKLY);
    await ok(s.admin.put(`/api/admin/goal-defaults/preset/${READ_WEEKLY}`, { archived: false }));
    expect(goalsOf(await ok(adaPhone.get('/api/student/page'))).presets.map((p: any) => p.id)).toContain(READ_WEEKLY);
    // Custom items are not school defaults.
    const own = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/goal-presets`, { categoryId: READING, text: { en: 'I will read comics.' } }));
    expect((await s.admin.put(`/api/admin/goal-defaults/preset/${own.id}`, { archived: true })).status).toBe(404);
    const actions = env.db.$client.prepare("select action from audit_events where action like 'goal_default.%' order by at").all() as Array<{ action: string }>;
    expect(actions.map((a) => a.action)).toEqual(['goal_default.archive', 'goal_default.restore']);
    const defaults = await ok(s.admin.get('/api/admin/goal-defaults'));
    expect(defaults.categories.length).toBeGreaterThanOrEqual(5);
    expect(defaults.presets.every((p: any) => p.custom === false)).toBe(true);
  });
});

// ---------------------------------------------------------------- item 14b
describe('student-page language override (item 14b, D-117)', () => {
  it('an English-only class can give its student pages Turkish only; "same as the class" follows class changes; classes are isolated', async () => {
    const r = await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'en', secondLanguageEnabled: false, studentPage: { mainLanguage: 'tr', secondLanguageEnabled: false } }));
    expect(r).toMatchObject({ mainLanguage: 'en', secondLanguageEnabled: false, studentPageMainLanguage: 'tr', studentPageSecondLanguageEnabled: false });
    expect((await ok(adaPhone.get('/api/student/page'))).language).toEqual({ mainLanguage: 'tr', secondLanguageEnabled: false });
    expect((await ok(cemPhone.get('/api/student/page'))).language).toEqual({ mainLanguage: 'en', secondLanguageEnabled: false });
    // The classroom keeps English only.
    const mine = (await ok(s.teacherA.get('/api/teacher/contexts'))).contexts.find((c: any) => c.id === s.ctxA.id);
    expect(mine).toMatchObject({ mainLanguage: 'en', secondLanguageEnabled: false, studentPageMainLanguage: 'tr' });
    // Changing only the class mode keeps the override when `studentPage` is not sent.
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'en', secondLanguageEnabled: true }));
    expect((await ok(adaPhone.get('/api/student/page'))).language).toEqual({ mainLanguage: 'tr', secondLanguageEnabled: false });
    // Back to "same as the class": follows the class.
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'tr', secondLanguageEnabled: true, studentPage: null }));
    expect((await ok(adaPhone.get('/api/student/page'))).language).toEqual({ mainLanguage: 'tr', secondLanguageEnabled: true });
    // Other teachers cannot set it; admins can on the class form.
    expect((await s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'en', secondLanguageEnabled: false, studentPage: { mainLanguage: 'tr', secondLanguageEnabled: true } })).status).toBe(403);
    const cls = await ok(s.admin.patch(`/api/admin/classes/${s.c3b.id}`, { studentPage: { mainLanguage: 'tr', secondLanguageEnabled: true } }));
    expect(cls).toMatchObject({ studentPageMainLanguage: 'tr', studentPageSecondLanguageEnabled: true });
    expect((await ok(cemPhone.get('/api/student/page'))).language).toEqual({ mainLanguage: 'tr', secondLanguageEnabled: true });
    const audits = env.db.$client.prepare("select count(*) n from audit_events where action = 'class.language'").get() as { n: number };
    expect(audits.n).toBe(3);
  });
});

// ---------------------------------------------------------------- items 13, 14c: fixtures
const id3v2 = (text: string) => {
  const frameBody = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
  const frame = Buffer.concat([Buffer.from('TIT2'), Buffer.from([0, 0, 0, frameBody.length]), Buffer.from([0, 0]), frameBody]);
  const size = frame.length;
  const syncsafe = Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe, frame]);
};
const mp3Frames = () => Buffer.concat(Array.from({ length: 20 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413, 0x11)])));
const id3v1 = (text: string) => {
  const b = Buffer.alloc(128);
  b.write('TAG', 0);
  b.write(text.slice(0, 30), 3);
  return b;
};
const taggedMp3 = () => Buffer.concat([id3v2(TAG_MARKER), mp3Frames(), id3v1(TAG_MARKER)]);

function wavWithInfo(text: string) {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(8000, 12);
  fmt.writeUInt32LE(16000, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const info = Buffer.from(`INFOINAM${String.fromCharCode(text.length + 1)}\0\0\0${text}\0`, 'latin1');
  const list = Buffer.concat([Buffer.from('LIST'), Buffer.alloc(4), info, info.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  list.writeUInt32LE(info.length, 4);
  const samples = Buffer.alloc(1600, 0);
  const data = Buffer.concat([Buffer.from('data'), Buffer.alloc(4), samples]);
  data.writeUInt32LE(samples.length, 4);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, data]);
  const head = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4)]);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function box(type: string, ...children: Buffer[]) {
  const body = Buffer.concat(children);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
const taggedMp4 = () =>
  Buffer.concat([
    box('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42isom', 'latin1')),
    box('moov', box('mvhd', Buffer.alloc(100)), box('trak', box('tkhd', Buffer.alloc(84)), box('udta', Buffer.from(TAG_MARKER))), box('udta', box('meta', Buffer.alloc(4), box('ilst', Buffer.from(TAG_MARKER))))),
    box('mdat', Buffer.alloc(64, 0x22)),
  ]);

function oggPage(headerType: number, granule: bigint, seq: number, packets: Buffer[]) {
  const segs: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      segs.push(255);
      n -= 255;
    }
    segs.push(n);
  }
  const head = Buffer.alloc(27 + segs.length);
  head.write('OggS', 0);
  head[5] = headerType;
  head.writeBigUInt64LE(granule, 6);
  head.writeUInt32LE(0x1234, 14);
  head.writeUInt32LE(seq, 18);
  head[26] = segs.length;
  Buffer.from(segs).copy(head, 27);
  const page = Buffer.concat([head, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}
function taggedOpus() {
  const opusHead = Buffer.concat([Buffer.from('OpusHead'), Buffer.from([1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0])]);
  const vendor = Buffer.from('fictional encoder');
  const comment = Buffer.from(`TITLE=${TAG_MARKER}`);
  const tags = Buffer.concat([Buffer.from('OpusTags'), Buffer.from([vendor.length, 0, 0, 0]), vendor, Buffer.from([1, 0, 0, 0]), Buffer.from([comment.length, 0, 0, 0]), comment]);
  return Buffer.concat([oggPage(2, 0n, 0, [opusHead]), oggPage(0, 0n, 1, [tags]), oggPage(0, 960n, 2, [Buffer.from([0xfc, 0xff, 0xfe])]), oggPage(4, 1920n, 3, [Buffer.from([0xfc, 0xff, 0xfe])])]);
}

function ebml(id: number[], body: Buffer) {
  const size = Buffer.alloc(8);
  size[0] = 0x01;
  size.writeUIntBE(body.length, 2, 6);
  return Buffer.concat([Buffer.from(id), size, body]);
}
const taggedWebm = () =>
  Buffer.concat([
    ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from('webm'))),
    ebml(
      [0x18, 0x53, 0x80, 0x67],
      Buffer.concat([
        ebml([0x15, 0x49, 0xa9, 0x66], Buffer.concat([ebml([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])), ebml([0x7b, 0xa9], Buffer.from(TAG_MARKER))])),
        ebml([0x16, 0x54, 0xae, 0x6b], ebml([0xae], ebml([0x86], Buffer.from('A_OPUS')))),
        ebml([0x12, 0x54, 0xc3, 0x67], ebml([0x73, 0x73], ebml([0x67, 0xc8], ebml([0x44, 0x87], Buffer.from(TAG_MARKER))))),
        // A live recording's cluster of unknown size.
        Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), Buffer.alloc(32, 0x33)]),
      ]),
    ),
  ]);

describe('audio tags are removed (item 14c, D-119)', () => {
  const marker = Buffer.from(TAG_MARKER);
  it('MP3: ID3v2 and ID3v1 are cut, the frames stay', () => {
    const out = stripAudioMetadata(taggedMp3(), 'audio/mpeg');
    expect(out.includes(marker)).toBe(false);
    expect(out.equals(mp3Frames())).toBe(true);
  });
  it('WAV: only fmt/data remain', () => {
    const out = stripAudioMetadata(wavWithInfo(TAG_MARKER), 'audio/wav');
    expect(out.includes(marker)).toBe(false);
    expect(out.includes(Buffer.from('LIST'))).toBe(false);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
  });
  it('MP4: udta/meta become zeroed free boxes of the same size', () => {
    const src = taggedMp4();
    const out = stripAudioMetadata(src, 'audio/mp4');
    expect(out.length).toBe(src.length);
    expect(out.includes(marker)).toBe(false);
    expect(out.includes(Buffer.from('udta'))).toBe(false);
    expect(out.includes(Buffer.from('mdat'))).toBe(true);
  });
  it('Ogg Opus: an empty comment header, valid page checksums and numbering', () => {
    const out = stripAudioMetadata(taggedOpus(), 'audio/ogg');
    expect(out.includes(marker)).toBe(false);
    let pos = 0;
    let seq = 0;
    while (pos < out.length) {
      expect(out.toString('latin1', pos, pos + 4)).toBe('OggS');
      expect(out.readUInt32LE(pos + 18)).toBe(seq++);
      const nsegs = out[pos + 26]!;
      const len = [...out.subarray(pos + 27, pos + 27 + nsegs)].reduce((a, b) => a + b, 0);
      const page = Buffer.from(out.subarray(pos, pos + 27 + nsegs + len));
      const crc = page.readUInt32LE(22);
      page.writeUInt32LE(0, 22);
      expect(oggCrc(page)).toBe(crc);
      pos += 27 + nsegs + len;
    }
    expect(seq).toBe(4);
    expect(out.includes(Buffer.from('OpusTags'))).toBe(true);
  });
  it('WebM: Tags and Title become Void elements', () => {
    const src = taggedWebm();
    const out = stripAudioMetadata(src, 'audio/webm');
    expect(out.length).toBe(src.length);
    expect(out.includes(marker)).toBe(false);
    expect(out.includes(Buffer.from('A_OPUS'))).toBe(true);
  });
  it('a broken file is refused rather than stored with tags we could not check', () => {
    expect(() => stripAudioMetadata(Buffer.from('OggS but not really'), 'audio/ogg')).toThrow();
    expect(() => stripAudioMetadata(id3v2(TAG_MARKER), 'audio/mpeg')).toThrow();
  });
});

describe('evidence kinds and teacher evidence (items 13, 14c, D-119)', () => {
  it('voice files are stored without tags; the audio flag decides; the teacher can play them', async () => {
    await setMedia('media.evidenceAudio', false);
    expect((await send(adaPhone, '/api/student/files?kind=audio', taggedMp3(), 'song.mp3', 'audio/mpeg')).body.error.details.reason).toBe('MEDIA_DISABLED');
    await setMedia('media.evidenceAudio', true);
    for (const [data, name, type] of [
      [taggedMp3(), 'voice.mp3', 'audio/mpeg'],
      [wavWithInfo(TAG_MARKER), 'voice.wav', 'audio/wav'],
    ] as const) {
      const up = await ok(send(adaPhone, '/api/student/files?kind=audio', data, name, type));
      const ev = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'audio', fileId: up.id }));
      const stored = await rawFile(s.teacherA, `/api/files/${ev.file.id}`);
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.includes(Buffer.from(TAG_MARKER))).toBe(false);
    }
    const detail = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));
    expect(detail.evidence.filter((e: any) => e.kind === 'audio')).toHaveLength(2);
    expect(detail.evidence.map((e: any) => e.file.mime).sort()).toEqual(['audio/mpeg', 'audio/wav']);
  });

  it('documents: PDF, DOCX, PPTX, ODT and TXT are accepted by content; markup and scripts are refused; always allowed', async () => {
    const pptx = new JSZip();
    pptx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
    pptx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    pptx.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
    const odt = new JSZip();
    odt.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    odt.file('content.xml', '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>');
    const cases: Array<[Buffer, string, string]> = [
      [await pptx.generateAsync({ type: 'nodebuffer' }), 'slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      [await odt.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), 'story.odt', 'application/vnd.oasis.opendocument.text'],
      [Buffer.from('My holiday story. I went to the sea.'), 'story.txt', 'text/plain'],
    ];
    for (const [data, name, type] of cases) {
      const up = await ok(send(adaPhone, '/api/student/files?kind=document', data, name, type));
      expect(up.mime).toBe(type);
    }
    const bad = await send(adaPhone, '/api/student/files?kind=document', Buffer.from('<html><script>alert(1)</script></html>'), 'story.txt', 'text/plain');
    expect(bad.body.error.details.reason).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('HEIC pictures get a clear reason; pictures follow the photo flag and are stored without EXIF at most 2048 px', async () => {
    await setMedia('media.evidencePhotos', true);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic'), Buffer.alloc(64)]);
    expect((await send(adaPhone, '/api/student/files?kind=image', heic, 'IMG_0001.HEIC', 'image/heic')).body.error.details.reason).toBe('IMAGE_HEIC');
    const gps = await sharp({ create: { width: 2600, height: 1300, channels: 3, background: '#3366aa' } })
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 46/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '29/1 4/1 0/1' } })
      .jpeg()
      .toBuffer();
    const up = await ok(send(adaPhone, '/api/student/files?kind=image', gps, 'class.jpg', 'image/jpeg'));
    const stored = await rawFile(adaPhone, `/api/student/files/${up.id}`);
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);
    await setMedia('media.evidencePhotos', false);
    expect((await send(adaPhone, '/api/student/files?kind=image', gps, 'class.jpg', 'image/jpeg')).body.error.details.reason).toBe('MEDIA_DISABLED');
  });

  it('a teacher adds text, link and file evidence for a student; the student sees it as the teacher’s and cannot delete it; isolation holds', async () => {
    const text = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'text', body: 'Read a page aloud in class' }));
    expect(text.authorType).toBe('teacher');
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'link', url: 'https://example.org/story' }));
    expect((await s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'link', url: 'javascript:alert(1)' })).status).toBe(400);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const file = await ok(send(s.teacherA, `/api/files?kind=document&ownerStudentId=${ada.id}`, pdf, 'worksheet.pdf', 'application/pdf'));
    const doc = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'file', fileId: file.id }));
    // The student opens the teacher's file on their own evidence.
    const page = goalsOf(await ok(adaPhone.get('/api/student/page')));
    expect(page.evidence.filter((e: any) => e.authorType === 'teacher')).toHaveLength(3);
    expect((await adaPhone.get(`/api/student/files/${file.id}`)).status).toBe(200);
    expect((await adaPhone.del(`/api/student/evidence/${doc.id}`)).status).toBe(403);
    // Another student's file, a student's own upload, or another class: refused.
    const studentUpload = await ok(send(adaPhone, '/api/student/files?kind=document', pdf, 'mine.pdf', 'application/pdf'));
    expect((await s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'file', fileId: studentUpload.id })).status).toBe(404);
    expect((await s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${cem.id}/evidence`, { kind: 'text', body: 'x' })).status).toBe(404);
    expect((await s.teacherB.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'text', body: 'x' })).status).toBe(403);
    expect((await cemPhone.get(`/api/student/files/${file.id}`)).status).toBe(404);
    // The teacher deletes their own evidence (and its file); never the student's.
    await ok(s.teacherA.del(`/api/teacher/evidence/${doc.id}`));
    expect((await adaPhone.get(`/api/student/files/${file.id}`)).status).toBe(404);
    const studentEv = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'My own words' }));
    expect((await s.teacherA.del(`/api/teacher/evidence/${studentEv.id}`)).body.error.details.reason).toBe('STUDENT_CONTRIBUTION');
    // Photo evidence by the teacher needs the photo flag too.
    await setMedia('media.evidencePhotos', false);
    const jpg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    expect((await send(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, jpg, 'p.jpg', 'image/jpeg')).body.error.details.reason).toBe('MEDIA_DISABLED');
  });
});
