import { describe, expect, it } from 'vitest';
import { isIsoDate, isValidTimeZone, localDate, schoolYearFor } from '../../src/domain/dates.ts';

describe('calendar helpers (DAT-1, DSH-2)', () => {
  it('validates timezones and ISO dates', () => {
    expect(isValidTimeZone('Europe/Istanbul')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isIsoDate('2027-02-28')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2027-2-1')).toBe(false);
  });

  it('computes the local date in the class timezone', () => {
    const lateEvening = Date.UTC(2026, 10, 9, 22, 30); // 01:30 on the 10th in Istanbul
    expect(localDate(lateEvening, 'Europe/Istanbul')).toBe('2026-11-10');
    expect(localDate(lateEvening, 'Europe/London')).toBe('2026-11-09');
  });

  it('derives the September–June school year from the clock', () => {
    expect(schoolYearFor(Date.UTC(2026, 10, 9), 'Europe/Istanbul')).toEqual({ name: '2026–2027', startsOn: '2026-09-01', endsOn: '2027-06-30' });
    expect(schoolYearFor(Date.UTC(2027, 2, 1), 'Europe/Istanbul').name).toBe('2026–2027');
    expect(schoolYearFor(Date.UTC(2027, 7, 15), 'Europe/Istanbul').name).toBe('2027–2028');
  });
});
