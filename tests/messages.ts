/**
 * Every string of the app for tests (S23a, D-182): the main dictionary (what the student page loads)
 * plus every area dictionary (the staff dictionary and the smaller areas of D-179). Tests and e2e specs
 * that look a text up by key import `en` / `tr` from here, so they do not care in which dictionary a key
 * lives. Importing the areas also registers them for `translate`.
 */
import { en as mainEn } from '../src/shared/i18n/en.ts';
import { tr as mainTr } from '../src/shared/i18n/tr.ts';
import * as staff from '../src/shared/i18n/areas/staff.ts';
import * as aiConnections from '../src/shared/i18n/areas/aiConnections.ts';
import * as aiConnect from '../src/shared/i18n/areas/aiConnect.ts';
import * as classroomCards from '../src/shared/i18n/areas/classroomCards.ts';

export const en = { ...mainEn, ...staff.en, ...aiConnections.en, ...aiConnect.en, ...classroomCards.en };
export const tr: Record<keyof typeof en, string> = { ...mainTr, ...staff.tr, ...aiConnections.tr, ...aiConnect.tr, ...classroomCards.tr };
