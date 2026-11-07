/**
 * Lesson topics in the teacher area (S13a, D-101): per class+subject, the weekly plan (which topic(s)
 * each weekday's lesson usually has; Start Lesson suggests them), the list of topics with their icons
 * (the subject's skill categories: Reading … Speaking, Phonics and the teacher's own), and adding a
 * custom topic with an icon. Default topics belong to the school and keep their icons.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Goals from '../../../shared/contracts/goals.ts';
import * as L from '../../../shared/contracts/lessons.ts';
import * as School from '../../../shared/contracts/school.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { MAX_LESSON_TOPICS, TOPIC_ICONS, type TopicIcon } from '../../../shared/lessons.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/Feedback.tsx';
import { Select } from '../../ui/Fields.tsx';
import { IconCheck, IconPlus } from '../../ui/icons.tsx';
import { LangFields, useEditorLocales } from '../../ui/LangFields.tsx';
import { TopicPicto } from '../../ui/pictos.tsx';

const PLAN_KEY = [SENSITIVE, 'teacher', 'topic-plan'] as const;
const DAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
type Day = (typeof DAYS)[number];

function IconPicker({ value, onChange, label }: { value: TopicIcon | null; onChange: (v: TopicIcon) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="cc-row cc-icon-picker" role="group" aria-label={label}>
      {TOPIC_ICONS.map((ic) => (
        <Button key={ic} size="small" aria-pressed={value === ic} aria-label={t(`lesson.topic.icon.${ic}` as MessageKey)} onPress={() => onChange(ic)}>
          <TopicPicto icon={ic} />
        </Button>
      ))}
    </div>
  );
}

export function TopicsPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const contexts = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [selected, setSelected] = useState('');
  const ctx = list.find((c) => c.id === selected) ?? list[0];
  const plan = useQuery({ queryKey: [...PLAN_KEY, ctx?.id], queryFn: () => call(L.getTopicPlan, { contextId: ctx!.id }), enabled: Boolean(ctx) });
  const library = useQuery({ queryKey: [SENSITIVE, 'teacher', 'goal-library', ctx?.id], queryFn: () => call(Goals.goalLibrary, { contextId: ctx!.id }), enabled: Boolean(ctx) });
  const locales = useEditorLocales(ctx ? [ctx.id] : []);
  const [draft, setDraft] = useState<Partial<Record<Day, string[]>> | null>(null);
  const [newName, setNewName] = useState<LocalizedTextValue>({});
  const [newIcon, setNewIcon] = useState<TopicIcon>('star');

  if (contexts.isSuccess && list.length === 0) return <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} />;
  const current: Partial<Record<Day, string[]>> = draft ?? (plan.data?.plan as Partial<Record<Day, string[]>> | undefined) ?? {};
  const topics = plan.data?.topics ?? [];
  const toggle = (day: Day, id: string) => {
    const ids = current[day] ?? [];
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < MAX_LESSON_TOPICS ? [...ids, id] : ids;
    setDraft({ ...current, [day]: next });
  };
  const invalidate = [[...PLAN_KEY], ['classroom', 'topics'], [SENSITIVE, 'teacher', 'goal-library']];
  const own = (library.data?.categories ?? []).filter((c) => c.custom && !c.archived);

  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('teacher.topics')}</h1>
      <p className="cc-muted">{t('lesson.topic.pageIntro')}</p>
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} value={ctx.id} onChange={(v) => (setSelected(v), setDraft(null))} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} />
          <section className="cc-card cc-stack" aria-labelledby="cc-topic-plan">
            <h2 id="cc-topic-plan" className="cc-h2">
              {t('lesson.topic.weeklyPlan')}
            </h2>
            <p className="cc-muted">{t('lesson.topic.weeklyPlanHint', { count: MAX_LESSON_TOPICS })}</p>
            <table className="cc-table cc-topic-plan" data-testid="topic-plan">
              <thead>
                <tr>
                  <th scope="col">{t('lesson.topic.day')}</th>
                  <th scope="col">{t('lesson.topic.topics')}</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d) => (
                  <tr key={d}>
                    <th scope="row">{t(`weekday.${Number(d) % 7}` as MessageKey)}</th>
                    <td>
                      <div className="cc-row" role="group" aria-label={t(`weekday.${Number(d) % 7}` as MessageKey)}>
                        {topics.map((tp) => (
                          <Button key={tp.id} size="small" aria-pressed={(current[d] ?? []).includes(tp.id)} onPress={() => toggle(d, tp.id)}>
                            <TopicPicto icon={tp.icon} size="1.2em" />
                            {pickText(tp.name, locale)}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cc-row">
              <Button
                variant="primary"
                isDisabled={!draft}
                onPress={() =>
                  void run(() => call(L.setTopicPlan, { contextId: ctx.id, plan: current }), { success: t('lesson.topic.planSaved'), invalidate }).then((r) => {
                    if (r) setDraft(null);
                  })
                }
              >
                <IconCheck />
                {t('lesson.topic.savePlan')}
              </Button>
              {draft ? <Button onPress={() => setDraft(null)}>{t('common.cancel')}</Button> : null}
            </div>
          </section>
          <section className="cc-card cc-stack" aria-labelledby="cc-topic-list">
            <h2 id="cc-topic-list" className="cc-h2">
              {t('lesson.topic.list')}
            </h2>
            <ul className="cc-row cc-topic-list">
              {topics.map((tp) => (
                <li key={tp.id} className="cc-chip">
                  <TopicPicto icon={tp.icon} size="1.2em" />
                  {pickText(tp.name, locale)}
                </li>
              ))}
            </ul>
            {own.length ? <h3 className="cc-h2">{t('lesson.topic.ownIcons')}</h3> : null}
            {own.map((c) => (
              <div key={c.id} className="cc-stack">
                <strong>{pickText(c.name, locale)}</strong>
                <IconPicker
                  label={t('lesson.topic.iconFor', { name: pickText(c.name, locale) })}
                  value={c.icon}
                  onChange={(icon) => void run(() => call(Goals.updateCategory, { categoryId: c.id, icon }), { invalidate })}
                />
              </div>
            ))}
            <h3 className="cc-h2">{t('lesson.topic.add')}</h3>
            <LangFields label={t('lesson.topic.name')} value={newName} onChange={setNewName} locales={locales} testId="new-topic-name" />
            <IconPicker label={t('lesson.topic.icon')} value={newIcon} onChange={setNewIcon} />
            <div>
              <Button
                variant="primary"
                isDisabled={!locales.some((l) => (newName[l] ?? '').trim())}
                onPress={() =>
                  void run(() => call(Goals.createCategory, { contextId: ctx.id, name: newName, icon: newIcon }), { success: t('lesson.topic.added'), invalidate }).then((r) => {
                    if (r) setNewName({});
                  })
                }
              >
                <IconPlus />
                {t('lesson.topic.addButton')}
              </Button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
