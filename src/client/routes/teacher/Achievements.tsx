/**
 * Achievements in the teacher area (PIN-gated in classroom mode): S13c items 1-8, D-121, D-122.
 * - Start: choose once how automatic badges begin ("award past achievements quietly" or "start fresh").
 * - Settings: automatic badges on/off, private levels on/off, the End Lesson "Well done!" moment.
 * - Students: each student's badges; give a badge from here; remove a mistaken one with a reason.
 * - Badges: hide a built-in badge for your classes, make your own (given by hand or automatic).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ACHIEVEMENT_TIERS, BADGE_ICONS, RULE_EVENTS, INACTIVE_EVENTS, type AchievementTier, type BadgeIcon, type RuleEvent } from '../../../shared/achievements.ts';
import * as A from '../../../shared/contracts/achievements.ts';
import * as School from '../../../shared/contracts/school.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { BadgeArt } from '../../achievements/icons.tsx';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { LangFields, useEditorLocales } from '../../ui/LangFields.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { Tabs } from '../../ui/Tabs.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'achievements'] as const;
const overviewKey = (contextId: string) => [...ALL, 'overview', contextId] as const;
const studentKey = (contextId: string, studentId: string) => [...ALL, 'student', contextId, studentId] as const;

const tierKey = (t: AchievementTier) => `achievements.tier.${t}` as MessageKey;
const eventKey = (e: RuleEvent) => `achievements.event.${e}` as MessageKey;

function StartCard({ contextId, settings }: { contextId: string; settings: A.AchievementSettings }) {
  const { t } = useI18n();
  const run = useRun();
  if (settings.startMode) {
    return <p className="cc-muted" data-testid="achievements-started">{t(settings.startMode === 'quiet' ? 'achievements.startedQuiet' : 'achievements.startedFresh')}</p>;
  }
  const start = (mode: 'quiet' | 'fresh') =>
    void run(() => call(A.startAchievements, { contextId, mode }), { success: t('achievements.startDone'), invalidate: [ALL] });
  return (
    <section className="cc-card cc-stack" data-testid="achievements-start">
      <h2 className="cc-h2">{t('achievements.startTitle')}</h2>
      <p>{t('achievements.startBody')}</p>
      <div className="cc-row">
        <Button variant="primary" onPress={() => start('quiet')} data-testid="achievements-start-quiet">
          {t('achievements.startQuiet')}
        </Button>
        <Button onPress={() => start('fresh')} data-testid="achievements-start-fresh">
          {t('achievements.startFresh')}
        </Button>
      </div>
    </section>
  );
}

function SettingsCard({ contextId, settings }: { contextId: string; settings: A.AchievementSettings }) {
  const { t } = useI18n();
  const run = useRun();
  const set = (patch: { autoEnabled?: boolean; levelsEnabled?: boolean; announce?: 'off' | 'endOfLesson' }) =>
    void run(() => call(A.setAchievementSettings, { contextId, ...patch }), { success: t('common.saved'), invalidate: [ALL] });
  return (
    <section className="cc-card cc-stack">
      <h2 className="cc-h2">{t('achievements.settings')}</h2>
      <Toggle label={t('achievements.autoEnabled')} isSelected={settings.autoEnabled} onChange={(v) => set({ autoEnabled: v })} />
      <Toggle label={t('achievements.levelsEnabled')} description={t('achievements.levelsHint')} isSelected={settings.levelsEnabled} onChange={(v) => set({ levelsEnabled: v })} />
      <Toggle label={t('achievements.announceEnd')} description={t('achievements.announceHint')} isSelected={settings.announce === 'endOfLesson'} onChange={(v) => set({ announce: v ? 'endOfLesson' : 'off' })} />
    </section>
  );
}

function StudentDialog({ contextId, studentId, onClose, manual }: { contextId: string; studentId: string; onClose: () => void; manual: A.AchievementDef[] }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: studentKey(contextId, studentId), queryFn: () => call(A.studentAchievements, { contextId, studentId }) });
  const [give, setGive] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  return (
    <Modal isOpen onOpenChange={(v) => (v ? null : onClose())} title={q.data ? q.data.student.fullName : t('common.loading')} size="wide" testId="achievements-student-dialog">
      <div className="cc-row">
        <Select label={t('achievements.giveBadge')} items={manual.map((d) => ({ id: d.id, label: pickText(d.name, locale) }))} value={give} onChange={setGive} placeholder={t('achievements.chooseBadge')} />
        <Button
          isDisabled={!give}
          onPress={() => void run(() => call(A.teacherAward, { contextId, achievementId: give, studentIds: [studentId] }), { success: t('achievements.given'), invalidate: [ALL] })}
          data-testid="achievements-teacher-give"
        >
          {t('achievements.give')}
        </Button>
      </div>
      <ul className="cc-badge-list">
        {(q.data?.awards ?? []).map((a) => (
          <li key={a.id} className="cc-badge" data-revoked={a.revokedAt ? true : undefined}>
            <BadgeArt icon={a.icon} tier={a.tier} size={44} locked={a.revokedAt !== null} />
            <span className="cc-stack cc-badge__text">
              <strong>{pickText(a.name, locale)}</strong>
              <span className="cc-muted">
                {t(tierKey(a.tier))} · {a.awardedBy ? t('achievements.givenBy', { name: a.awardedBy }) : t(a.source === 'backfill' ? 'achievements.sourceBackfill' : 'achievements.sourceAuto')}
              </span>
              {a.revokedAt ? <span className="cc-muted">{t('achievements.removedBecause', { reason: a.revokeReason === 'undo' ? t('achievements.undo') : (a.revokeReason ?? '') })}</span> : null}
            </span>
            {a.source === 'manual' && !a.revokedAt ? (
              <Button size="small" className="cc-push-right" onPress={() => setRevoking(a.id)}>
                {t('achievements.remove')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {revoking ? (
        <div className="cc-stack">
          <TextField label={t('achievements.removeReason')} value={reason} onChange={setReason} />
          <div className="cc-row">
            <Button onPress={() => setRevoking(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              isDisabled={reason.trim().length < 3}
              onPress={() =>
                void run(() => call(A.revokeAward, { awardId: revoking, reason }), { success: t('achievements.removed'), invalidate: [ALL] }).then(() => {
                  setRevoking(null);
                  setReason('');
                })
              }
            >
              {t('achievements.remove')}
            </Button>
          </div>
        </div>
      ) : null}
      <DialogActions>
        <Button variant="primary" onPress={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function NewBadge({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const locales = useEditorLocales([contextId]);
  const [name, setName] = useState<LocalizedTextValue>({});
  const [description, setDescription] = useState<LocalizedTextValue>({});
  const [icon, setIcon] = useState<BadgeIcon>('star');
  const [tier, setTier] = useState<AchievementTier>('bronze');
  const [kind, setKind] = useState<'manual' | 'auto'>('manual');
  const [event, setEvent] = useState<RuleEvent>('goal_set');
  const [threshold, setThreshold] = useState('3');
  const n = Number.parseInt(threshold, 10);
  const valid = Boolean(name.en?.trim() || name.tr?.trim()) && (kind === 'manual' || (Number.isInteger(n) && n >= 1 && n <= 500));
  const save = () =>
    void run(
      () =>
        call(A.createAchievement, {
          contextId,
          name: name as { en?: string; tr?: string },
          description,
          icon,
          tier,
          kind,
          rule: kind === 'auto' ? { event, threshold: n } : null,
        }),
      { success: t('achievements.created'), invalidate: [ALL] },
    ).then((r) => {
      if (r) setName({});
    });
  return (
    <section className="cc-card cc-stack" data-testid="achievements-new">
      <h2 className="cc-h2">{t('achievements.newBadgeTitle')}</h2>
      <LangFields label={t('achievements.badgeName')} value={name} onChange={setName} locales={locales} testId="achievements-new-name" />
      <LangFields label={t('achievements.badgeDescription')} value={description} onChange={setDescription} locales={locales} />
      <div className="cc-row">
        <Select label={t('achievements.icon')} items={BADGE_ICONS.map((i) => ({ id: i, label: i }))} value={icon} onChange={(v) => setIcon(v as BadgeIcon)} />
        <BadgeArt icon={icon} tier={tier} size={56} />
        <Select label={t('achievements.tierLabel')} items={ACHIEVEMENT_TIERS.map((x) => ({ id: x, label: t(tierKey(x)) }))} value={tier} onChange={(v) => setTier(v as AchievementTier)} />
      </div>
      <Select
        label={t('achievements.kind')}
        items={[
          { id: 'manual', label: t('achievements.kindManual') },
          { id: 'auto', label: t('achievements.kindAuto') },
        ]}
        value={kind}
        onChange={(v) => setKind(v as 'manual' | 'auto')}
      />
      {kind === 'auto' ? (
        <div className="cc-row">
          <Select label={t('achievements.ruleEvent')} items={RULE_EVENTS.filter((e) => !INACTIVE_EVENTS.includes(e)).map((e) => ({ id: e, label: t(eventKey(e)) }))} value={event} onChange={(v) => setEvent(v as RuleEvent)} />
          <TextField label={t('achievements.ruleThreshold')} value={threshold} onChange={setThreshold} inputMode="numeric" />
        </div>
      ) : null}
      <div>
        <Button variant="primary" isDisabled={!valid} onPress={save} data-testid="achievements-new-save">
          {t('achievements.create')}
        </Button>
      </div>
    </section>
  );
}

function BadgesTab({ contextId, defs }: { contextId: string; defs: A.AchievementDef[] }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const toggle = (d: A.AchievementDef) => void run(() => call(A.updateAchievement, { contextId, achievementId: d.id, archived: !d.archived }), { invalidate: [ALL] });
  return (
    <div className="cc-stack">
      <NewBadge contextId={contextId} />
      <ul className="cc-badge-list" aria-label={t('achievements.allBadges')}>
        {defs.map((d) => (
          <li key={d.id} className="cc-badge" data-archived={d.archived || undefined} data-testid="achievements-def">
            <BadgeArt icon={d.icon} tier={d.tier} size={44} locked={d.archived} />
            <span className="cc-stack cc-badge__text">
              <strong>{pickText(d.name, locale)}</strong>
              <span className="cc-muted">
                {t(tierKey(d.tier))} · {d.kind === 'manual' ? t('achievements.kindManual') : t('achievements.kindAuto')}
                {d.inactive ? ` · ${t('achievements.inactive')}` : ''}
                {d.custom ? ` · ${t('achievements.custom')}` : ''}
              </span>
              <span className="cc-muted">{pickText(d.description, locale)}</span>
            </span>
            {d.schoolArchived ? (
              <span className="cc-chip cc-push-right">{t('achievements.schoolArchived')}</span>
            ) : (
              <Button size="small" className="cc-push-right" onPress={() => toggle(d)}>
                {d.archived ? t('achievements.show') : t('achievements.hide')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverviewTab({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: overviewKey(contextId), queryFn: () => call(A.achievementsOverview, { contextId }) });
  const [student, setStudent] = useState<string | null>(null);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const d = q.data;
  const manual = d.definitions.filter((x) => x.kind === 'manual' && !x.archived);
  return (
    <div className="cc-stack">
      {!d.enabled ? <Alert kind="warning">{t('achievements.moduleOff')}</Alert> : null}
      <StartCard contextId={contextId} settings={d.settings} />
      <SettingsCard contextId={contextId} settings={d.settings} />
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('achievements.students')}</h2>
        <p className="cc-muted">{t('achievements.noRanking')}</p>
        <ul className="cc-stack">
          {d.students.map((s) => (
            <li key={s.id} className="cc-row">
              <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
              <Button variant="ghost" onPress={() => setStudent(s.id)} data-testid="achievements-student-open">
                {s.fullName}
              </Button>
              <span className="cc-muted cc-push-right">{t('achievements.studentCounts', { manual: s.manual, auto: s.auto })}</span>
            </li>
          ))}
        </ul>
      </section>
      {student ? <StudentDialog contextId={contextId} studentId={student} manual={manual} onClose={() => setStudent(null)} /> : null}
    </div>
  );
}

function BadgesLoader({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: overviewKey(contextId), queryFn: () => call(A.achievementsOverview, { contextId }) });
  return q.data ? <BadgesTab contextId={contextId} defs={q.data.definitions} /> : <p className="cc-muted">{t('common.loading')}</p>;
}

export function AchievementsPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState<string>('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-stack" data-testid="achievements-page">
      <h1 className="cc-h1">{t('teacher.achievements')}</h1>
      {contexts.isSuccess && !ctx ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          <Tabs
            key={ctx.id}
            label={t('teacher.achievements')}
            items={[
              { id: 'overview', label: t('achievements.tab.overview'), content: <OverviewTab contextId={ctx.id} /> },
              { id: 'badges', label: t('achievements.tab.badges'), content: <BadgesLoader contextId={ctx.id} /> },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}
