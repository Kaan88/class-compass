/**
 * The "Still teaching" button of the reminder (S37, D-218: the teacher home's banner and the board's
 * note). It sends `lesson.stillTeaching` now or not at all (`sendStillTeachingNow`, never the outbox):
 * offline it is disabled with a visible reason beside it (tied by `aria-describedby`); a press that
 * fails says why (no connection, or the server's reason, e.g. the lesson has ended); on success
 * `onDone` hides the reminder.
 */
import { useId, useState } from 'react';
import { commandErrorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useOutboxStatus } from '../../lib/outbox-client.ts';
import { Button } from '../../ui/Button.tsx';
import { sendStillTeachingNow } from './lessonClient.ts';

export function StillTeachingButton({ contextId, lessonId, onDone }: { contextId: string; lessonId: string; onDone: () => void }) {
  const { t } = useI18n();
  const { online } = useOutboxStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const note = !online ? t('lessonNotice.offline') : error;
  return (
    <>
      <Button
        isDisabled={!online || busy}
        aria-describedby={note ? noteId : undefined}
        onPress={async () => {
          setBusy(true);
          setError(null);
          const r = await sendStillTeachingNow({ contextId, lessonId });
          setBusy(false);
          if (r.ok) onDone();
          else setError(r.network ? t('error.NETWORK') : commandErrorText(t, r.error));
        }}
      >
        {t('lessonNotice.stillTeaching')}
      </Button>
      {note ? (
        <span id={noteId} className="cc-muted" role={online ? 'alert' : undefined} data-testid="still-teaching-note">
          {note}
        </span>
      ) : null}
    </>
  );
}
