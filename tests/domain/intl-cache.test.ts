/**
 * Cached Intl formatters and collators (S15a, D-162; DSH-2, UX-5): the cached helpers give exactly
 * what a formatter or collator built per call gave, reuse one object per locale and options, and do
 * not cache a timezone the runtime refuses.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from '../../src/domain/dates.ts';
import { orderedLevels } from '../../src/domain/grouping.ts';
import { formatDate, formatDay, formatWeekRange } from '../../src/shared/i18n/index.ts';
import { collator, compareTr, dateTimeFormat } from '../../src/shared/intl.ts';

const ZONES = ['Europe/Istanbul', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'UTC', 'Pacific/Chatham'];
const instant = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 0, 1) });

describe('cached Intl helpers (S15a, D-162)', () => {
  it('localDate equals a formatter built per call, for any instant and timezone (DSH-2)', () => {
    fc.assert(
      fc.property(instant, fc.constantFrom(...ZONES), (ms, tz) => {
        expect(localDate(ms, tz)).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms));
      }),
    );
  });

  it('the shared date texts equal formatters built per call', () => {
    fc.assert(
      fc.property(instant, fc.constantFrom(...ZONES), fc.constantFrom('en' as const, 'tr' as const), (ms, tz, locale) => {
        const tag = locale === 'tr' ? 'tr-TR' : 'en-GB';
        const opts = { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' } as const;
        expect(formatDate(ms, locale, tz, opts)).toBe(new Intl.DateTimeFormat(tag, { timeZone: tz, ...opts }).format(ms));
        const iso = new Date(ms).toISOString().slice(0, 10);
        expect(formatDay(iso, locale)).toBe(new Intl.DateTimeFormat(tag, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(Date.parse(`${iso}T12:00:00Z`)));
        expect(formatDay(iso, locale, { year: false })).toBe(new Intl.DateTimeFormat(tag, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(Date.parse(`${iso}T12:00:00Z`)));
      }),
    );
    expect(formatWeekRange('2026-11-09', '2026-11-15', 'en')).toBe('Mon 9 Nov – Sun 15 Nov');
  });

  it('one object per locale and options; a refused timezone throws every time and is not cached', () => {
    expect(dateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' })).toBe(dateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }));
    expect(dateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' })).not.toBe(dateTimeFormat('en-CA', { timeZone: 'Europe/London' }));
    expect(collator('tr')).toBe(collator('tr'));
    expect(() => dateTimeFormat('en-CA', { timeZone: 'Mars/Olympus' })).toThrow(RangeError);
    expect(() => dateTimeFormat('en-CA', { timeZone: 'Mars/Olympus' })).toThrow(RangeError);
  });

  it('compareTr sorts like localeCompare with the Turkish locale (UX-5)', () => {
    const words = ['ılık', 'ışık', 'İnci', 'inci', 'Çiçek', 'cami', 'Öykü', 'oya', 'şeker', 'sarı', 'ğ', 'g', 'Ü', 'u', 'A2', 'A10'];
    expect([...words].sort(compareTr)).toEqual([...words].sort((a, b) => a.localeCompare(b, 'tr')));
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => Math.sign(compareTr(a, b)) === Math.sign(a.localeCompare(b, 'tr'))));
    // The grouping solver's level order keeps its numeric Turkish collation.
    expect(orderedLevels(['B1', 'A10', 'A2', 'İleri', 'Başlangıç'])).toEqual(orderedLevels(['Başlangıç', 'A2', 'B1', 'İleri', 'A10']));
  });
});
