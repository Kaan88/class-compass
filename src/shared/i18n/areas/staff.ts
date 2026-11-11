/**
 * The staff dictionary (S23a, D-182): every string the personal student page never shows (the teacher
 * and admin app, the classroom screen, Super Speakers, emails, reports and notifications). An area
 * dictionary (D-179) that every entry except the student page imports first (`client/main.tsx`,
 * `client/scorer/main.tsx`, `client/board/main.tsx`) and the server through `server/lib/i18n.ts`, so the
 * student page downloads only the main dictionary (`../en.ts`, `../tr.ts`; D-151 budget).
 * `tests/scripts/i18n-split.test.ts` keeps the split exact: a key the student page can show belongs in the
 * main dictionary, every other key here (`node scripts/i18n-split.ts` lists the keys to move).
 */
import { registerMessages } from '../index.ts';
import { en } from './staff/en.ts';
import { tr } from './staff/tr.ts';

export { en, tr };
export const staffMessages = { en, tr };
registerMessages(staffMessages);
