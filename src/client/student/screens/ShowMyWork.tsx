/**
 * "Show my work" (S14d, D-151; GOL-4, D-014, D-119): the shared `EvidenceAdder` in its `steps` layout
 * (how → which goal, "For all my learning" for none → the work and a few words with sentence
 * starters), then the work already added. Picture and voice choices appear only while the admin media
 * flags allow them; there is still one upload pipeline.
 */
import { useI18n } from '../../lib/i18n.tsx';
import * as G from '../../../shared/contracts/goals.ts';
import type { StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { call, upload } from '../../lib/api.ts';
import { EvidenceAdder } from '../../modules/goals/EvidenceAdder.tsx';
import { EvidenceView, goalText } from '../../modules/goals/shared.tsx';
import { IconTrash } from '../../ui/icons.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { startersOf, useSaveCheck, useStudentRun } from '../common.tsx';
import { SentenceStarters } from '../SentenceStarters.tsx';
import type { ScreenProps } from '../sections.tsx';

export function ShowMyWork({ data, subjectId, media, nav, go, finish }: ScreenProps<StudentGoalsSection>) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const check = useSaveCheck(data);
  const live = data.goals.filter((g) => g.status !== 'archived');
  return (
    <div className="cc-stack">
      {data.canWrite ? (
        <EvidenceAdder
          layout="steps"
          step={nav.step}
          onStep={(n, replace) => go({ screen: 'showMyWork', subject: subjectId, step: n }, { replace })}
          onDone={() => finish({ screen: 'showMyWork', subject: subjectId })}
          idPrefix={`evidence-${subjectId}`}
          goals={live.map((g) => ({ id: g.id, label: goalText(g, locale) }))}
          media={media}
          upload={(kind, file, name, onProgress) => upload(G.studentUploadFile, { kind }, file, name, onProgress)}
          add={(input) => call(G.studentAddEvidence, { subjectId, ...input })}
          run={(fn, success) => run(fn, success)}
          check={check}
          starters={({ kind, goalId, value, onChange, target }) => (
            <SentenceStarters starters={startersOf(data, kind, locale, live.find((g) => g.id === goalId)?.category.id ?? null)} value={value} onChange={onChange} target={target} />
          )}
        />
      ) : (
        <p className="cc-card cc-muted">{t('student.readOnly')}</p>
      )}
      {nav.step <= 1 ? (
        <section className="cc-stack" aria-labelledby={`my-work-${subjectId}`}>
          <h2 id={`my-work-${subjectId}`} className="cc-h2">
            {t('student.work.mine')}
          </h2>
          {data.evidence.length === 0 ? <p className="cc-muted">{t('student.work.none')}</p> : null}
          <ul className="cc-stack" data-testid="student-evidence">
            {data.evidence.map((e) => (
              <EvidenceView
                key={e.id}
                item={e}
                fileUrl={G.studentFileUrl}
                actions={
                  data.canWrite && e.authorType === 'student' ? (
                    <div>
                      <InlineConfirmButton
                        size="small"
                        variant="ghost"
                        message={t('student.confirm.delete')}
                        confirmLabel={t('student.confirm.yes')}
                        cancelLabel={t('student.confirm.no')}
                        onConfirm={() => void run(() => call(G.studentDeleteEvidence, { evidenceId: e.id }), t('student.toast.deleted'))}
                      >
                        <IconTrash />
                        {t('student.delete')}
                      </InlineConfirmButton>
                    </div>
                  ) : null
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
