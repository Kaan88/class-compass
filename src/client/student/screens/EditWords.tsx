/**
 * "Change my words" on My goals (S22b, D-176; GOL-5): a student changes the words of their own goal or
 * of something they wrote about a goal, in the page, with the same sentence starters and the same
 * check on Save as when they wrote it (hints only when Save is pressed, D-151). Loaded only when a
 * child opens it (a lazy chunk), so the student page stays within its size budget (D-151).
 */
import { useRef, useState } from 'react';
import type { StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import type { StarterKind } from '../../../shared/text/starters.ts';
import type { TextKind } from '../../../shared/text/textQuality.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { TextArea } from '../../ui/Fields.tsx';
import { IconCheck } from '../../ui/icons.tsx';
import { focusBox, startersOf, useSaveCheck } from '../common.tsx';
import { SentenceStarters } from '../SentenceStarters.tsx';

export interface EditWordsProps {
  data: StudentGoalsSection;
  /** The words as they are now. */
  initial: string;
  /** The text box's label ("My goal", "My words"). */
  label: string;
  textKind: TextKind;
  starterKind: StarterKind;
  categoryId: string | null;
  maxLength: number;
  /** Sends the new words; resolves true when they were saved. */
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}

export default function EditWords({ data, initial, label, textKind, starterKind, categoryId, maxLength, onSave, onCancel }: EditWordsProps) {
  const { t, locale } = useI18n();
  const check = useSaveCheck(data);
  const [text, setText] = useState(initial);
  const [hint, setHint] = useState<string>();
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const change = (v: string) => {
    setText(v);
    setHint(undefined);
  };
  const save = async () => {
    const words = text.trim();
    if (words === initial.trim()) return onCancel();
    const r = check(words, textKind);
    setHint(r.hint);
    if (!r.send) return focusBox(box.current);
    setBusy(true);
    try {
      if (!(await onSave(words))) focusBox(box.current);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cc-stack cc-student-edit" data-testid="student-edit-words">
      <SentenceStarters starters={startersOf(data, starterKind, locale, categoryId)} value={text} onChange={change} target={box} />
      <TextArea label={label} rows={3} value={text} onChange={change} maxLength={maxLength} errorMessage={hint} inputRef={box} autoFocus />
      <div className="cc-row">
        <Button variant="primary" isDisabled={!text.trim() || busy} onPress={() => void save()}>
          <IconCheck />
          {t('student.edit.save')}
        </Button>
        <Button variant="ghost" onPress={onCancel}>
          {t('student.edit.cancel')}
        </Button>
      </div>
    </div>
  );
}
