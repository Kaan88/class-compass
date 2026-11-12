/**
 * "Add my work" on a goal in My goals (S27b, D-194): the shared `EvidenceAdder` steps for that goal (how,
 * then the work; no goal step), with the text checks and sentence starters of the writing screens. A
 * lazy chunk (S26c, D-191; budget D-151), so My goals loads without them; `MyGoals` owns the address
 * and what happens after Save.
 */
import * as G from '../../../shared/contracts/goals.ts';
import type { Goal, StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { call, upload } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { EvidenceAdder } from '../../modules/goals/EvidenceAdder.tsx';
import { goalText } from '../../modules/goals/shared.tsx';
import { startersOf, useSaveCheck } from '../common.tsx';
import { useStudentRun } from '../run.ts';
import { SentenceStarters } from '../SentenceStarters.tsx';
import type { ScreenProps } from '../sections.tsx';

export interface GoalAddWorkProps extends Pick<ScreenProps<StudentGoalsSection>, 'data' | 'subjectId' | 'media' | 'nav' | 'go'> {
  goal: Goal;
  onDone: () => void;
}

export function GoalAddWork({ data, goal, subjectId, media, nav, go, onDone }: GoalAddWorkProps) {
  const { locale } = useI18n();
  const run = useStudentRun();
  const check = useSaveCheck(data);
  return (
    <div className="cc-stack" data-testid="student-goal-add-work">
      <EvidenceAdder
        layout="steps"
        step={nav.step - 1 /* the address's step 1 is the goal list (`ADD_WORK_FIRST_STEP` in MyGoals) */}
        onStep={(n, replace) => go({ screen: 'goals', subject: subjectId, goal: goal.id, step: n + 1 }, { replace })}
        onDone={onDone}
        idPrefix={`goal-work-${goal.id}`}
        goals={[]}
        fixedGoal={{ id: goal.id, label: goalText(goal, locale) }}
        media={media}
        upload={(kind, file, name) => upload(G.studentUploadFile, { kind }, file, name)}
        add={(input) => call(G.studentAddEvidence, { subjectId, ...input })}
        run={(fn, success) => run(fn, success)}
        check={check}
        starters={({ kind, value, onChange, target }) => (
          <SentenceStarters starters={startersOf(data, kind, locale, goal.category.id)} value={value} onChange={onChange} target={target} />
        )}
      />
    </div>
  );
}
