/**
 * Runs before every test file. Registers the staff dictionary (S23a, D-182), as every app entry except
 * the student page does at start (`client/main.tsx`, the scorer and board entries, `server/lib/i18n.ts`),
 * so a component or server function tested on its own shows its words, not its keys. That the student
 * page needs no staff string is checked statically in `tests/scripts/i18n-split.test.ts`.
 */
import '../src/shared/i18n/areas/staff.ts';
