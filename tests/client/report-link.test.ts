// @vitest-environment jsdom
/**
 * S14e1 review (D-153): the Reports deep link. `from` / `to` reach the period maths only when they
 * are real 'YYYY-MM-DD' days, so a mistyped or cut-off link (`?period=week&from=2026-11`) opens the
 * default period instead of throwing during render (RPT-2).
 */
import { describe, expect, it } from 'vitest';
import { linkFromSearch, linkSearch } from '../../src/client/reports/ReportsPage.tsx';
import { presetRange } from '../../src/domain/periods.ts';

const cal = { today: '2026-11-09', weekStartsOn: 1, year: { from: '2026-09-07', to: '2027-06-18' }, terms: [{ from: '2026-09-07', to: '2027-01-22' }] };

describe('report deep link (D-153, RPT-2)', () => {
  it('keeps every parameter of a good link and round-trips it', () => {
    const search = { contextId: 'c1', studentId: 's1', view: 'studentOverview', period: 'custom', from: '2026-10-01', to: '2026-10-31' };
    expect(linkFromSearch(search)).toEqual(search);
    expect(linkSearch(linkFromSearch(search))).toEqual(search);
  });

  it.each(['garbage', 'x', '2026-11', '2026-13-45', '2026-02-30', '2026-11-09T00:00', ' 2026-11-09'])('drops a date that is not a real day: %s', (bad) => {
    const link = linkFromSearch({ period: 'week', from: bad, to: bad, view: 'everything' });
    expect(link).toEqual({ period: 'week', view: 'everything' });
    // What the page then computes: the default week, no RangeError.
    expect(() => presetRange('week', cal, link.from)).not.toThrow();
    expect(presetRange('week', cal, link.from)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });

  it('ignores parameters that are not strings or not part of the link', () => {
    expect(linkFromSearch({ from: 20261109, tab: 'contexts', view: '' })).toEqual({});
  });
});
