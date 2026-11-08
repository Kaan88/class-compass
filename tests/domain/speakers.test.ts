/**
 * Super Speakers rules (S12, D-130, D-133): the weekly window around Monday 00:00 Istanbul (property
 * test), the dense-ranked podium with ties (every tied student listed), class totals with zeros, and the Turkish
 * search (folding, word starts, class keys, student numbers) including a 1,500-student performance
 * check. Synthetic data only.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, classTotals, inWeek, podium, searchStudents, totalsByStudent, weekRangeOf } from '../../src/domain/speakers.ts';
import { localDate } from '../../src/domain/dates.ts';

const TZ = 'Europe/Istanbul';
/** Monday 2026-11-16 00:00 in Istanbul (UTC+3). */
const MONDAY = Date.UTC(2026, 10, 15, 21, 0, 0);

describe('weekly window (SSP-7)', () => {
  it('turns over exactly at Monday 00:00 in the school timezone', () => {
    expect(weekRangeOf(MONDAY - 1, TZ)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(weekRangeOf(MONDAY, TZ)).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  it('property: any instant near the boundary belongs to the week before or after by its local time', () => {
    fc.assert(
      fc.property(fc.integer({ min: -3 * 86_400_000, max: 3 * 86_400_000 }), (offset) => {
        const t = MONDAY + offset;
        const w = weekRangeOf(t, TZ);
        expect(w.start).toBe(offset < 0 ? '2026-11-09' : '2026-11-16');
        // The instant's own local date is inside its week, and the week is seven days long.
        expect(inWeek(localDate(t, TZ), w)).toBe(true);
        expect(Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)).toBe(6 * 86_400_000);
      }),
      { numRuns: 500 },
    );
  });

  it('property: every week starts on the chosen weekday, whatever the instant', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2030, 0, 1) }), fc.integer({ min: 0, max: 6 }), (t, startsOn) => {
        const w = weekRangeOf(t, TZ, startsOn);
        expect(new Date(`${w.start}T12:00:00Z`).getUTCDay()).toBe(startsOn);
        expect(inWeek(localDate(t, TZ), w)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('podium (SSP-1, D-133)', () => {
  const name = (s: string) => s;

  it('ranks densely, shares places on equal points and never shows 0', () => {
    const p = podium(
      [
        { student: 'Zeynep', points: 5 },
        { student: 'Ali', points: 5 },
        { student: 'Çağrı', points: 3 },
        { student: 'Deniz', points: 2 },
        { student: 'Ece', points: 1 },
        { student: 'Fırat', points: 0 },
      ],
      name,
    );
    expect(p).toEqual([
      { rank: 1, points: 5, students: ['Ali', 'Zeynep'] },
      { rank: 2, points: 3, students: ['Çağrı'] },
      { rank: 3, points: 2, students: ['Deniz'] },
    ]);
  });

  it('is empty without points (placeholder) and has fewer places with fewer totals', () => {
    expect(podium([], name)).toEqual([]);
    expect(podium([{ student: 'Ali', points: 0 }], name)).toEqual([]);
    expect(podium([{ student: 'Ali', points: 1 }], name)).toHaveLength(1);
  });

  it('lists every tied name of a place in Turkish order, however many (owner decision 1, D-133)', () => {
    const names = ['Şule', 'Ömer', 'Çınar', 'İpek', 'Işıl', 'Ufuk', 'Gül', 'Ayşe', 'Zafer'];
    const p = podium(
      names.map((n) => ({ student: n, points: 4 })),
      name,
    );
    expect(p).toHaveLength(1);
    expect(p[0]!.students).toEqual(['Ayşe', 'Çınar', 'Gül', 'Işıl', 'İpek', 'Ömer', 'Şule', 'Ufuk', 'Zafer']);
    const crowd = podium(
      Array.from({ length: 120 }, (_, i) => ({ student: `Öğrenci ${String(i).padStart(3, '0')}`, points: 1 })),
      name,
    );
    expect(crowd[0]!.students).toHaveLength(120);
  });

  it('property: places are strictly decreasing, every shown student has that total, nobody is lost', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 8 }), { maxLength: 60 }), (pts) => {
        const scores = pts.map((points, i) => ({ student: `S${String(i).padStart(2, '0')}`, points }));
        const p = podium(scores, name);
        const distinct = [...new Set(pts.filter((x) => x > 0))].sort((a, b) => b - a).slice(0, 3);
        expect(p.map((x) => x.points)).toEqual(distinct);
        p.forEach((place, i) => {
          expect(place.rank).toBe(i + 1);
          const tied = scores.filter((s) => s.points === place.points);
          expect(place.students.length).toBe(tied.length);
          for (const st of place.students) expect(tied.some((t) => t.student === st)).toBe(true);
        });
      }),
      { numRuns: 300 },
    );
  });
});

describe('totals', () => {
  it('counts points per student and shows every class, including 0, by total then Turkish name', () => {
    const rows = [{ studentId: 'a' }, { studentId: 'a' }, { studentId: 'b' }];
    expect([...totalsByStudent(rows)]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    const classes = [
      { id: '1', name: '4-Ç' },
      { id: '2', name: '4-C' },
      { id: '3', name: '3-A' },
      { id: '4', name: '5-B' },
    ];
    expect(classTotals(classes, [{ classId: '4' }, { classId: '4' }, { classId: '1' }]).map((c) => `${c.name}:${c.points}`)).toEqual(['5-B:2', '4-Ç:1', '3-A:0', '4-C:0']);
  });
});

describe('search (SSP-6)', () => {
  const people = [
    { id: '1', fullName: 'Işık Yıldız', classId: 'c3a', className: '3-A', studentNumber: '1203' },
    { id: '2', fullName: 'İlker Şahin', classId: 'c3a', className: '3-A', studentNumber: '1204' },
    { id: '3', fullName: 'Ayşe Gül Çelik', classId: 'c4b', className: '4/B', studentNumber: null },
    { id: '4', fullName: 'Can Işıklı', classId: 'c4b', className: '4/B', studentNumber: '2201' },
  ];
  const index = buildSearchIndex(people);
  const ids = (q: string, classId?: string) => searchStudents(index, q, classId ? { classId } : {}).map((s) => s.id);

  it('folds Turkish letters and matches any word start', () => {
    expect(ids('isik')).toEqual(['1', '4']);
    expect(ids('IŞIK')).toEqual(['1', '4']);
    expect(ids('yil')).toEqual(['1']);
    expect(ids('gul')).toEqual(['3']);
    expect(ids('celik')).toEqual(['3']);
    expect(ids('ilker sah')).toEqual(['2']);
    expect(ids('sik')).toEqual([]);
  });

  it('finds classes without separators and student numbers by prefix', () => {
    expect(ids('3a')).toEqual(['1', '2']);
    expect(ids('3-a')).toEqual(['1', '2']);
    expect(ids('4b')).toEqual(['3', '4']);
    expect(ids('1203')).toEqual(['1']);
    expect(ids('22')).toEqual(['4']);
  });

  it('ranks whole-word matches first and filters by class', () => {
    // "Işık" is a whole first name of 1; a word start of "Işıklı" (4).
    expect(ids('ışık')[0]).toBe('1');
    expect(ids('isik', 'c4b')).toEqual(['4']);
    expect(ids('', 'c4b')).toEqual(['3', '4']);
    expect(ids('')).toEqual([]);
  });

  it('handles 1,500 students quickly (index once, search per keystroke)', () => {
    const first = ['Ayşe', 'Işık', 'İlker', 'Çağla', 'Ömer', 'Şule', 'Gökhan', 'Ufuk', 'Zeynep', 'Deniz', 'Ece', 'Barış'];
    const last = ['Yıldız', 'Şahin', 'Çelik', 'Öztürk', 'Kaya', 'Demir', 'Aydın', 'Arslan', 'Doğan', 'Kılıç'];
    const many = Array.from({ length: 1500 }, (_, i) => ({
      id: `s${i}`,
      fullName: `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]} ${i}`,
      classId: `c${i % 50}`,
      className: `${(i % 8) + 1}-${'ABCDEFG'[i % 7]}`,
      studentNumber: String(10000 + i),
    }));
    let t0 = performance.now();
    const big = buildSearchIndex(many);
    const indexMs = performance.now() - t0;
    t0 = performance.now();
    for (const q of ['i', 'is', 'isi', 'isik', 'isik y', 'isik yil', '3a', '1012', 'zeynep kaya', 'xyz']) searchStudents(big, q);
    const perQuery = (performance.now() - t0) / 10;
    expect(searchStudents(big, 'isik yil').every((s) => s.fullName.startsWith('Işık Yıldız'))).toBe(true);
    expect(searchStudents(big, 'isik').length).toBe(40);
    // Generous bounds for slow CI machines; typically a few milliseconds.
    expect(indexMs).toBeLessThan(500);
    expect(perQuery).toBeLessThan(50);
  });
});
