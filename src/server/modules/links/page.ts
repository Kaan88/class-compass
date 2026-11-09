/**
 * The personal student page (STU-2, STU-5): one response with the student's own sections for each
 * subject of the classes they are in today. Sections come from module manifests (`studentPage`) of
 * the modules enabled for that class+subject; the student id always comes from the link session.
 * When a subject is taught in more than one of the student's classes, the oldest context answers and
 * the first section of each key wins (D-085).
 */
import type { StudentPage, StudentPageSection } from '../../../shared/contracts/goals.ts';
import { DEFAULT_CLASS_LANGUAGE, studentPageLanguage } from '../../../shared/classLanguage.ts';
import { DEFAULT_THEME } from '../../../shared/themes.ts';
import { initials } from '../../../shared/text/turkish.ts';
import { requireStudent, type RequestContext } from '../../lib/context.ts';
import { studentPageContributions } from '../index.ts';
import { studentAvatarInfo } from '../avatars/service.ts';
import { getMediaPolicy } from '../school/modules.ts';
import { limitsOf } from '../textChecks/service.ts';
import { studentScope } from './scope.ts';
import { effectiveTheme } from '../themes/service.ts';

export function studentPage(ctx: RequestContext): StudentPage {
  const { studentId } = requireStudent(ctx);
  const scope = studentScope(ctx, studentId);
  const media = getMediaPolicy(ctx.db);
  const subjects: StudentPage['subjects'] = [];
  for (const sc of scope.contexts) {
    let entry = subjects.find((s) => s.subjectId === sc.subject.id);
    if (!entry) {
      entry = { subjectId: sc.subject.id, name: sc.subject.name, sections: [] };
      subjects.push(entry);
    }
    for (const c of studentPageContributions(ctx.db, sc.context.id)) {
      if (entry.sections.some((s) => s.key === c.key)) continue;
      const data = c.build(ctx, { studentId, context: sc.context, cls: sc.cls });
      if (data !== null) entry.sections.push({ key: c.key, data } as StudentPageSection);
    }
  }
  return {
    student: { fullName: scope.student.fullName, initials: initials(scope.student.fullName), avatarHue: scope.student.avatarHue },
    className: scope.classes.length ? scope.classes.map((c) => c.name).join(', ') : null,
    theme: scope.classes[0] ? effectiveTheme(ctx.db, scope.classes[0].theme) : DEFAULT_THEME,
    // The student-page language of the class (S13b2, D-117): the class mode unless the class gives its student pages their own.
    language: scope.classes[0] ? studentPageLanguage(scope.classes[0]) : DEFAULT_CLASS_LANGUAGE,
    media: { photos: media.evidencePhotos, audio: media.evidenceAudio, documents: media.evidenceDocuments },
    subjects: subjects.filter((s) => s.sections.length > 0),
    avatar: studentAvatarInfo(ctx.db, scope.student, scope.classes),
    textLimits: limitsOf(ctx.db),
  };
}
