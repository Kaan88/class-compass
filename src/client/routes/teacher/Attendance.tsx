/**
 * Attendance in the teacher area (ACC-8/9, ATT-1/2; PIN-gated): daily attendance for a class and
 * date (shared with the other teachers of the class), the signed-in teacher's lesson exceptions for
 * that day, and history with who changed what. Notes are only shown here, never on the classroom
 * display.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '../../../domain/attendance.ts';
import { isIsoDate } from '../../../shared/dates.ts';
import * as L from '../../../shared/contracts/lessons.ts';
import * as School from '../../../shared/contracts/school.ts';
import { formatDate, formatDay, pickText, type Locale } from '../../../shared/i18n/index.ts';
import { sortByName } from '../../../shared/text/turkish.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { AttendanceChip, Avatar, MetricCell } from '../../ui/Students.tsx';
import { StudentName } from '../../ui/StudentName.tsx';
import { IconNote } from '../../ui/icons.tsx';

const key = (...rest: unknown[]) => [SENSITIVE, 'teacher', 'attendance', ...rest];

/** A school day in the history list: "Fri 6 Nov" / "6 Kas Cum" (never the ISO form on screen). */
const shortDay = (date: string, locale: Locale) => formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', { weekday: 'short', day: 'numeric', month: 'short' });
const longDay = (date: string, locale: Locale) => formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * The four statuses as one segmented control, then Clear and Note. Below 52rem the statuses fill
 * the card's width in four equal columns and Clear / Note sit on the line under them (usability
 * audit 2026-11: they used to stack one per line, about 590px per student).
 */
function StatusButtons({ value, onSet, name, onNote, noteDisabled }: { value: AttendanceStatus | null; onSet: (s: AttendanceStatus | null) => void; name: string; onNote: () => void; noteDisabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="cc-att-set">
      <div className="cc-segmented cc-att-set__statuses" role="group" aria-label={t('attendance.statusFor', { name })}>
        {ATTENDANCE_STATUSES.map((s) => (
          <Button key={s} size="small" aria-pressed={value === s} onPress={() => onSet(s)}>
            {t(`attendance.status.${s}`)}
          </Button>
        ))}
      </div>
      <div className="cc-att-set__more">
        <Button size="small" variant="ghost" isDisabled={value === null} onPress={() => onSet(null)}>
          {t('attendance.clear')}
        </Button>
        <Button size="small" isDisabled={noteDisabled} aria-label={t('attendance.noteFor', { name })} onPress={onNote}>
          <IconNote />
        </Button>
      </div>
    </div>
  );
}

function NoteDialog({ name, note, onClose, onSave }: { name: string; note: string; onClose: () => void; onSave: (n: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(note);
  return (
    <Modal isOpen onOpenChange={(o) => (o ? null : onClose())} title={t('attendance.noteFor', { name })}>
      <TextField label={t('attendance.note')} value={value} onChange={setValue} maxLength={300} autoFocus />
      <DialogActions>
        <Button onPress={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onPress={() => onSave(value)}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

export function AttendancePage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const contexts = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  const classes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of contexts.data?.contexts ?? []) seen.set(c.classId, c.className);
    return sortByName([...seen].map(([id, name]) => ({ id, name })), (c) => c.name);
  }, [contexts.data]);
  const [classId, setClassId] = useState('');
  const cid = classId || classes[0]?.id || '';
  const [dateInput, setDateInput] = useState('');
  const date = isIsoDate(dateInput) ? dateInput : undefined;
  const day = useQuery({ queryKey: key('day', cid, date ?? 'today'), queryFn: () => call(L.getClassAttendance, { classId: cid, ...(date ? { date } : {}) }), enabled: Boolean(cid) });
  const shownDate = day.data?.date;
  const history = useQuery({ queryKey: key('history', cid, shownDate), queryFn: () => call(L.attendanceHistory, { classId: cid, ...(shownDate ? { date: shownDate } : {}) }), enabled: Boolean(cid && shownDate) });
  const [noteFor, setNoteFor] = useState<{ studentId: string; name: string; note: string } | null>(null);
  const [exc, setExc] = useState<{ lessonId: string; studentId: string; status: string }>({ lessonId: '', studentId: '', status: 'present' });

  if (contexts.isSuccess && classes.length === 0) return <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} />;
  const refresh = [key('day', cid), key('history', cid), ['classroom', 'roster'], ['classroom', 'lesson']];
  const setDaily = (studentId: string, status: AttendanceStatus | null, note?: string) =>
    run(() => call(L.setClassAttendance, { classId: cid, date: shownDate!, studentId, status, ...(note !== undefined ? { note } : {}) }), { invalidate: refresh });
  const nameOf = (id: string) => day.data?.students.find((s) => s.studentId === id)?.fullName ?? '—';
  // Times in the class timezone like everywhere else (DSH-2), never the device's.
  const classTz = contexts.data?.contexts.find((c) => c.classId === cid)?.timezone;
  const fmtTime = (ms: number) => (classTz ? formatDate(ms, locale, classTz, { hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <main className="cc-page cc-stack" data-testid="attendance-page">
      <h1 className="cc-h1">{t('attendance.title')}</h1>
      <p className="cc-muted">{t('attendance.sharedHint')}</p>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select label={t('teacher.chooseClass')} value={cid} onChange={setClassId} items={classes.map((c) => ({ id: c.id, label: c.name }))} />
        <TextField label={t('attendance.date')} type="date" value={dateInput || shownDate || ''} onChange={setDateInput} />
        {day.data && day.data.date !== day.data.today ? <Button onPress={() => setDateInput(day.data!.today)}>{t('attendance.today')}</Button> : null}
      </div>

      {day.data ? (
        <DataTable
          caption={t('attendance.dayCaption', { className: day.data.className, date: longDay(day.data.date, locale) })}
          rows={day.data.students}
          rowKey={(s) => s.studentId}
          emptyText={t('students.none')}
          stack
          columns={[
            {
              key: 'name',
              header: t('students.name'),
              sortValue: (s) => s.fullName,
              stackRole: 'title',
              render: (s) => (
                <span className="cc-row">
                  <Avatar name={s.fullName} id={s.studentId} hue={s.avatarHue} initials={s.initials} size="sm" />
                  <StudentName id={s.studentId} name={s.fullName} classId={cid} />
                </span>
              ),
            },
            { key: 'status', header: t('attendance.statusCol'), render: (s) => <AttendanceChip status={s.status ?? 'not_recorded'} /> },
            {
              key: 'actions',
              header: t('common.actions'),
              render: (s) => (
                <StatusButtons
                  name={s.fullName}
                  value={s.status}
                  onSet={(v) => void setDaily(s.studentId, v)}
                  noteDisabled={!s.status}
                  onNote={() => setNoteFor({ studentId: s.studentId, name: s.fullName, note: s.note ?? '' })}
                />
              ),
            },
            { key: 'note', header: t('attendance.note'), render: (s) => s.note ?? '—' },
            // Who recorded it is in the change list below; on a phone the card leaves it out.
            { key: 'by', header: t('attendance.recordedBy'), stackRole: 'hidden', render: (s) => (s.recordedByName ? `${s.recordedByName} · ${fmtTime(s.updatedAt!)}` : '—') },
          ]}
        />
      ) : null}

      {day.data ? (
        <section className="cc-card cc-stack" aria-labelledby="att-exceptions">
          <h2 id="att-exceptions" className="cc-h2">
            {t('attendance.exceptions')}
          </h2>
          <p className="cc-muted">{t('attendance.exceptionsHint')}</p>
          {day.data.lessons.length === 0 ? <p className="cc-muted">{t('attendance.noLessons')}</p> : null}
          {day.data.lessons.map((l) => (
            <div key={l.id} className="cc-stack">
              <h3 className="cc-h2">
                {pickText(l.subjectName, locale)} · {fmtTime(l.startedAt)}
              </h3>
              {l.exceptions.length === 0 ? <p className="cc-muted">{t('attendance.noExceptions')}</p> : null}
              <ul className="cc-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {l.exceptions.map((e) => (
                  <li key={e.studentId} className="cc-row">
                    <span>{nameOf(e.studentId)}</span>
                    <AttendanceChip status={e.status} lessonOnly />
                    <Button size="small" onPress={() => void run(() => call(L.setLessonExceptionTeacher, { lessonId: l.id, studentId: e.studentId, status: null }), { invalidate: refresh })}>
                      {t('attendance.removeException')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {day.data.lessons.length ? (
            <div className="cc-row" style={{ alignItems: 'flex-end' }}>
              <Select
                label={t('attendance.lesson')}
                value={exc.lessonId || day.data.lessons[0]!.id}
                onChange={(lessonId) => setExc({ ...exc, lessonId })}
                items={day.data.lessons.map((l) => ({ id: l.id, label: `${pickText(l.subjectName, locale)} · ${fmtTime(l.startedAt)}` }))}
              />
              <Select label={t('students.name')} value={exc.studentId} placeholder={t('common.choose')} onChange={(studentId) => setExc({ ...exc, studentId })} items={day.data.students.map((s) => ({ id: s.studentId, label: s.fullName }))} />
              <Select label={t('attendance.statusCol')} value={exc.status} onChange={(status) => setExc({ ...exc, status })} items={ATTENDANCE_STATUSES.map((s) => ({ id: s, label: t(`attendance.status.${s}`) }))} />
              <Button
                variant="primary"
                isDisabled={!exc.studentId}
                onPress={() =>
                  void run(() => call(L.setLessonExceptionTeacher, { lessonId: exc.lessonId || day.data!.lessons[0]!.id, studentId: exc.studentId, status: exc.status as AttendanceStatus }), {
                    success: t('save.saved'),
                    invalidate: refresh,
                  })
                }
              >
                {t('attendance.addException')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {history.data ? (
        <>
          <DataTable
            caption={t('attendance.historyCaption', { from: formatDay(history.data.from, locale), to: formatDay(history.data.to, locale) })}
            rows={history.data.days}
            rowKey={(d) => d.date}
            emptyText={t('attendance.noHistory')}
            stack
            compact
            columns={[
              { key: 'date', header: t('attendance.date'), sortValue: (d) => d.date, stackRole: 'title', render: (d) => <Button size="small" variant="ghost" onPress={() => setDateInput(d.date)}>{shortDay(d.date, locale)}</Button> },
              ...(['present', 'absent', 'late', 'excused', 'not_recorded'] as const).map((k) => ({ key: k, header: t(`attendance.status.${k}`), render: (d: (typeof history.data.days)[number]) => <MetricCell value={d[k]} /> })),
            ]}
          />
          <DataTable
            caption={t('attendance.changesCaption', { date: shownDate ? longDay(shownDate, locale) : '' })}
            rows={history.data.changes.map((c, i) => ({ ...c, i }))}
            rowKey={(c) => String(c.i)}
            emptyText={t('attendance.noChanges')}
            stack
            columns={[
              { key: 'at', header: t('audit.when'), render: (c) => fmtTime(c.at) },
              { key: 'who', header: t('audit.who'), render: (c) => c.actorName ?? t('audit.unknown') },
              { key: 'student', header: t('students.name'), render: (c) => c.studentName ?? '—' },
              { key: 'kind', header: t('attendance.kind'), render: (c) => (c.kind === 'daily' ? t('attendance.kindDaily') : t('attendance.thisLesson')) },
              {
                key: 'change',
                header: t('audit.change'),
                render: (c) => (
                  <span className="cc-row">
                    <AttendanceChip status={c.before ?? 'not_recorded'} />→<AttendanceChip status={c.after ?? 'not_recorded'} />
                  </span>
                ),
              },
            ]}
          />
        </>
      ) : null}

      {noteFor ? (
        <NoteDialog
          name={noteFor.name}
          note={noteFor.note}
          onClose={() => setNoteFor(null)}
          onSave={(n) => {
            const s = day.data?.students.find((x) => x.studentId === noteFor.studentId);
            if (s?.status) void setDaily(noteFor.studentId, s.status, n);
            setNoteFor(null);
          }}
        />
      ) : null}
    </main>
  );
}
