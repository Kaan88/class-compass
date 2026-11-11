/**
 * Translation on the server (S23a, D-182): the main dictionary plus the staff dictionary, which holds
 * every string the student page never shows (emails, notification digests, reports). Server code takes
 * `translate` from here, never from `shared/i18n/index.ts` directly (lint test in
 * `tests/scripts/i18n-split.test.ts`), so the staff strings are registered before the first translation.
 */
import '../../shared/i18n/areas/staff.ts';

export { pickText, translate, type Locale } from '../../shared/i18n/index.ts';
