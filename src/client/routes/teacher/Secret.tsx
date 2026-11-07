/**
 * Secret Students in the teacher area (PIN-gated in classroom mode): SEC-1, SEC-6, D-062, D-064.
 * - Settings: how many students a draw chooses.
 * - History: revealed selections and outcomes only. Sealed (lesson still running) and abandoned
 *   selections are never shown as selected (D-010), so this page cannot spoil a running round.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as S from '../../../shared/contracts/secret.ts';
import * as School from '../../../shared/contracts/school.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { dayLabel } from '../../modules/assistant/AssistantPanel.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { Avatar } from '../../ui/Students.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'secret'] as const;

type Who = { id: string; fullName: string; initials: string; avatarHue: number };
function Name({ s }: { s: Who }) {
  return (
    <span className="cc-row" style={{ gap: '0.5rem' }}>
      <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
      {s.fullName}
    </span>
  );
}

function Settings({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: [...ALL, 'settings', contextId], queryFn: () => call(S.getSecretSettings, { contextId }) });
  const [draft, setDraft] = useState<string | null>(null);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const value = draft ?? String(q.data.count);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= S.SECRET_MAX_COUNT;
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-secret-settings">
      <h2 id="cc-secret-settings" className="cc-h2">
        {t('secret.settingsTitle')}
      </h2>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <TextField
          label={t('secret.countLabel')}
          description={t('secret.countHint', { max: S.SECRET_MAX_COUNT })}
          inputMode="numeric"
          value={value}
          onChange={setDraft}
          errorMessage={valid ? null : t('secret.countInvalid', { max: S.SECRET_MAX_COUNT })}
        />
        <Button
          variant="primary"
          isDisabled={!valid}
          onPress={() => void run(() => call(S.setSecretSettings, { contextId, count: n }), { success: t('secret.settingsSaved'), invalidate: [ALL] }).then((r) => r && setDraft(null))}
        >
          {t('common.save')}
        </Button>
      </div>
    </section>
  );
}

const outcomeText = (t: ReturnType<typeof useI18n>['t'], o: string | null) => t(`secret.outcome.${o ?? 'not_assessed'}` as MessageKey);

function History({ contextId }: { contextId: string }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: [...ALL, 'history', contextId], queryFn: () => call(S.secretHistory, { contextId }) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const rounds = q.data.rounds.filter((r) => r.state === 'revealed');
  const d = (x: string | null) => (x ? dayLabel(x, locale, { day: 'numeric', month: 'short' }) : '–');
  return (
    <div className="cc-stack">
      <DataTable
        caption={t('secret.historyStudents')}
        rows={q.data.students}
        rowKey={(r) => r.student.id}
        emptyText={t('secret.historyEmpty')}
        columns={[
          { key: 'name', header: t('common.name'), render: (r) => <Name s={r.student} />, sortValue: (r) => r.student.fullName },
          { key: 'revealed', header: t('secret.col.revealed'), render: (r) => r.revealed, sortValue: (r) => r.revealed },
          { key: 'met', header: t('secret.outcome.goal_met'), render: (r) => r.goalMet, sortValue: (r) => r.goalMet },
          { key: 'practising', header: t('secret.outcome.still_practising'), render: (r) => r.stillPractising, sortValue: (r) => r.stillPractising },
          { key: 'last', header: t('secret.col.last'), render: (r) => d(r.lastRevealedDate), sortValue: (r) => r.lastRevealedDate ?? '' },
        ]}
      />
      <section className="cc-stack" aria-labelledby="cc-secret-rounds">
        <h2 id="cc-secret-rounds" className="cc-h2">
          {t('secret.historyRounds')}
        </h2>
        {rounds.length === 0 ? <p className="cc-muted">{t('secret.historyEmpty')}</p> : null}
        <ol className="cc-stack">
          {rounds.map((r) => (
            <li key={r.roundId} className="cc-card cc-stack">
              <strong>{dayLabel(r.localDate, locale)}</strong>
              <ul className="cc-stack">
                {r.selections.map((s) => (
                  <li key={s.selectionId} className="cc-row">
                    <Name s={s.student} />
                    <span>{outcomeText(t, s.outcome)}</span>
                    {s.note ? <span className="cc-muted">{s.note}</span> : null}
                  </li>
                ))}
              </ul>
              {r.absent.map((a) => (
                <p key={a.student.id} className="cc-muted">
                  {a.replaced ? t('secret.absentReplaced', { name: a.student.fullName }) : t('secret.absentNotReplaced', { name: a.student.fullName })}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function SecretPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-stack" data-testid="secret-page">
      <h1 className="cc-h1">{t('teacher.secret')}</h1>
      <p className="cc-muted">{t('secret.teacherIntro')}</p>
      {contexts.isSuccess && !ctx ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          {ctx.modules.secretStudents === false ? <Alert kind="warning">{t('secret.moduleOff')}</Alert> : null}
          <Settings key={`s${ctx.id}`} contextId={ctx.id} />
          <History key={`h${ctx.id}`} contextId={ctx.id} />
        </>
      ) : null}
    </main>
  );
}
