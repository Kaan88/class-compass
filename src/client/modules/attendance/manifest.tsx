/** Attendance: Start Lesson step, in-lesson attendance button + dialog, student-card chips and counts, teacher page (LES-1, ATT-1..5). */
import { AttendancePage } from '../../routes/teacher/Attendance.tsx';
import { IconClipboardCheck } from '../../ui/icons.tsx';
import { attendanceInvalidation } from '../lessons/lessonClient.ts';
import { defineClientModule } from '../types.ts';
import { attendanceCardAddon, attendanceDashboardSlot, attendanceStartStep } from './AttendanceClassroom.tsx';

export const attendanceClientManifest = defineClientModule({
  key: 'attendance',
  policyKey: 'attendance',
  i18nNamespace: 'attendance',
  dashboardSlots: [attendanceDashboardSlot],
  startSteps: [attendanceStartStep],
  studentCardAddons: [attendanceCardAddon],
  teacherPages: [{ key: 'attendance', path: 'attendance', labelKey: 'teacher.attendance', Icon: IconClipboardCheck, order: 40, Component: AttendancePage }],
  invalidations: [attendanceInvalidation],
});
