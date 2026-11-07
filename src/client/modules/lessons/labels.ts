import { pickText } from '../../../shared/i18n/index.ts';
import type { ClassroomContext } from '../types.ts';

/** "3-A · English": names the class+subject on toasts and trays (LES-4). */
export const classLabel = (c: { className: string; subjectName: ClassroomContext['subjectName'] }, locale: 'en' | 'tr') => `${c.className} · ${pickText(c.subjectName, locale)}`;
