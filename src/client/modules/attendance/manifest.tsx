/** Attendance: teacher-area page and attendance command refreshes (the classroom list is part of the lesson screens). */
import { AttendancePage } from '../../routes/teacher/Attendance.tsx';
import { IconCalendar } from '../../ui/icons.tsx';
import { attendanceInvalidation } from '../lessons/lessonClient.ts';
import { defineClientModule } from '../types.ts';

export const attendanceClientManifest = defineClientModule({
  key: 'attendance',
  policyKey: 'attendance',
  i18nNamespace: 'attendance',
  teacherPages: [{ key: 'attendance', path: 'attendance', labelKey: 'teacher.attendance', Icon: IconCalendar, order: 40, Component: AttendancePage }],
  invalidations: [attendanceInvalidation],
});
