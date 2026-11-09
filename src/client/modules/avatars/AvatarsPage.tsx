/**
 * Avatars in the teacher area (S13c item 11, D-124): per class, pause avatar changes, choose what shows
 * before a student picks (a generated avatar or initials), and reset one student's avatar (typed
 * confirmation with the student's name; audited with the previous spec).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Av from '../../../shared/contracts/avatars.ts';
import * as School from '../../../shared/contracts/school.ts';
import { classroomRoster } from '../../../shared/contracts/students.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { AVATARS_KEY } from '../../avatars/AvatarDirectory.tsx';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive } from '../../ui/Dialog.tsx';
import { EmptyState } from '../../ui/Feedback.tsx';
import { Select, Toggle } from '../../ui/Fields.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { StudentName } from '../../ui/StudentName.tsx';

const settingsKey = (classId: string) => [SENSITIVE, 'teacher', 'avatars', classId] as const;

function ClassAvatars({ classId }: { classId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const s = useQuery({ queryKey: settingsKey(classId), queryFn: () => call(Av.getAvatarSettings, { classId }) });
  const roster = useQuery({ queryKey: ['classroom', 'roster-names', classId], queryFn: () => call(classroomRoster, { classId }) });
  const set = (patch: { locked?: boolean; fallback?: 'generated' | 'initials' }) =>
    void run(() => call(Av.setAvatarSettings, { classId, ...patch }), { success: t('common.saved'), invalidate: [settingsKey(classId), AVATARS_KEY] });
  if (!s.data) return <p className="cc-muted">{t('common.loading')}</p>;
  return (
    <div className="cc-stack">
      <section className="cc-card cc-stack">
        <Toggle label={t('avatar.lockClass')} description={t('avatar.lockHint')} isSelected={s.data.locked} onChange={(v) => set({ locked: v })} />
        <Select
          label={t('avatar.fallback')}
          items={[
            { id: 'generated', label: t('avatar.fallbackGenerated') },
            { id: 'initials', label: t('avatar.fallbackInitials') },
          ]}
          value={s.data.fallback}
          onChange={(v) => set({ fallback: v as 'generated' | 'initials' })}
        />
      </section>
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('avatar.students')}</h2>
        <ul className="cc-stack">
          {(roster.data?.students ?? []).map((st) => (
            <li key={st.id} className="cc-row">
              <Avatar name={st.fullName} id={st.id} hue={st.avatarHue} initials={st.initials} size="sm" />
              <StudentName id={st.id} name={st.fullName} classId={classId} />
              <Button size="small" className="cc-push-right" onPress={() => setResetting({ id: st.id, name: st.fullName })} data-testid="avatar-reset">
                {t('avatar.reset')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDestructive
        isOpen={resetting !== null}
        onOpenChange={(open) => (open ? null : setResetting(null))}
        title={t('avatar.resetConfirmTitle', { name: resetting?.name ?? '' })}
        description={t('avatar.resetConfirmBody', { name: resetting?.name ?? '' })}
        confirmText={resetting?.name ?? ''}
        actionLabel={t('avatar.reset')}
        onConfirm={() => (resetting ? run(() => call(Av.resetStudentAvatar, { studentId: resetting.id }), { success: t('avatar.resetDone'), invalidate: [AVATARS_KEY] }) : undefined)}
      />
    </div>
  );
}

export function AvatarsPage() {
  const { t } = useI18n();
  const contexts = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  const classes = [...new Map((contexts.data?.contexts ?? []).map((c) => [c.classId, { id: c.classId, label: c.className }])).values()];
  const [picked, setPicked] = useState('');
  const cls = classes.find((c) => c.id === picked) ?? classes[0];
  return (
    <main className="cc-page cc-stack" data-testid="avatars-page">
      <h1 className="cc-h1">{t('teacher.avatars')}</h1>
      <p className="cc-muted">{t('avatar.teacherIntro')}</p>
      {contexts.isSuccess && !cls ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {cls ? (
        <>
          <Select label={t('teacher.chooseClass')} items={classes} value={cls.id} onChange={setPicked} />
          <ClassAvatars key={cls.id} classId={cls.id} />
        </>
      ) : null}
    </main>
  );
}
