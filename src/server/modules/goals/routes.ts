import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/goals.ts';
import type { AppDeps } from '../../lib/context.ts';
import { rawRoute, route } from '../../lib/http.ts';
import { assertCanReadFile, sendFile } from '../files/service.ts';
import { ensureGoalDefaults } from './library.ts';
import * as student from './student.ts';
import * as teacher from './teacher.ts';

/** Student uploads: at most 20 per minute per address (sniffing and re-encoding are expensive). */
const STUDENT_UPLOAD_RATE = { max: 20, timeWindow: '1 minute' };

const ok = { ok: true as const };

export function registerGoalRoutes(app: FastifyInstance, deps: AppDeps) {
  // Default skill categories and preset goals (GOL-1), created once with fixed ids.
  ensureGoalDefaults(deps.db, deps.now());

  // Teacher area (PIN-gated in classroom mode).
  route(app, deps, C.goalsOverview, (ctx, input) => teacher.overview(ctx, input.contextId));
  route(app, deps, C.teacherStudentGoals, (ctx, input) => teacher.studentDetail(ctx, input.contextId, input.studentId));
  route(app, deps, C.teacherCreateGoal, (ctx, input) => teacher.createGoal(ctx, input));
  route(app, deps, C.teacherUpdateGoal, (ctx, input) => teacher.updateGoal(ctx, input));
  route(app, deps, C.teacherAddProgress, (ctx, input) => teacher.addProgress(ctx, input));
  route(app, deps, C.teacherAssessGoal, (ctx, input) => teacher.assess(ctx, input));
  route(app, deps, C.teacherAddFeedback, (ctx, input) => teacher.addFeedback(ctx, input));
  route(app, deps, C.teacherDeleteFeedback, (ctx, input) => {
    teacher.deleteFeedback(ctx, input.feedbackId);
    return ok;
  });
  route(app, deps, C.teacherAddEvidence, (ctx, input) => teacher.addEvidence(ctx, input));
  route(app, deps, C.teacherDeleteEvidence, async (ctx, input) => {
    await teacher.deleteEvidence(ctx, input.evidenceId);
    return ok;
  });
  route(app, deps, C.teacherAddPrivateNote, (ctx, input) => teacher.privateNote(ctx, input));
  route(app, deps, C.teacherDeletePrivateNote, (ctx, input) => {
    teacher.removePrivateNote(ctx, input.noteId);
    return ok;
  });
  route(app, deps, C.goalLibrary, (ctx, input) => teacher.library(ctx, input.contextId));
  route(app, deps, C.createCategory, (ctx, input) => teacher.createCategory(ctx, input));
  route(app, deps, C.updateCategory, (ctx, input) => teacher.updateCategory(ctx, input));
  route(app, deps, C.createPreset, (ctx, input) => teacher.createPreset(ctx, input));
  route(app, deps, C.updatePreset, (ctx, input) => teacher.updatePreset(ctx, input));
  route(app, deps, C.adminGoalDefaults, (ctx) => teacher.adminDefaults(ctx));
  route(app, deps, C.adminArchiveGoalDefault, (ctx, input) => teacher.adminArchiveDefault(ctx, input));
  route(app, deps, C.goalSettings, (ctx, input) => teacher.getSettings(ctx, input.contextId));
  route(app, deps, C.setGoalSettings, (ctx, input) => teacher.setSettings(ctx, input));

  // Student link session (studentId from the session only, STU-4/5).
  route(app, deps, C.studentCreateGoal, (ctx, input) => student.createGoal(ctx, input));
  route(app, deps, C.studentUpdateGoal, (ctx, input) => student.updateGoal(ctx, input));
  route(app, deps, C.studentDeleteGoal, (ctx, input) => {
    student.deleteGoal(ctx, input.goalId);
    return ok;
  });
  route(app, deps, C.studentAddEntry, (ctx, input) => student.addEntry(ctx, input));
  route(app, deps, C.studentUpdateEntry, (ctx, input) => student.updateEntry(ctx, input));
  route(app, deps, C.studentDeleteEntry, (ctx, input) => {
    student.deleteEntry(ctx, input.entryId);
    return ok;
  });
  route(app, deps, C.studentAddEvidence, (ctx, input) => student.addEvidence(ctx, input));
  route(app, deps, C.studentUpdateEvidence, (ctx, input) => student.updateEvidence(ctx, input));
  route(app, deps, C.studentDeleteEvidence, async (ctx, input) => {
    await student.deleteEvidence(ctx, input.evidenceId);
    return ok;
  });
  rawRoute(app, deps, C.studentUploadFile, (ctx, input, { req }) => student.uploadEvidenceFile(ctx, req, input.kind), { rateLimit: STUDENT_UPLOAD_RATE });
  rawRoute(app, deps, C.studentGetFile, async (ctx, input, { req, reply }) => sendFile(ctx, req, reply, assertCanReadFile(ctx, input.fileId), { thumb: input.thumb ?? false }));
}
