/**
 * A PIN pad in a dialog (S14b, D-148): asks for the teacher's PIN before a teacher-area action that
 * starts on the classroom screen ("Customise layout"). Same lockout rules and messages as the lock
 * screen (`usePinUnlock`). It names only the action, nothing from the teacher area (PIN-2/3).
 */
import { usePinUnlock } from '../lib/pinUnlock.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { DialogActions, Modal } from './Dialog.tsx';
import { PinPad } from './PinPad.tsx';

export function PinDialog({ isOpen, onOpenChange, title, hint, onUnlocked }: { isOpen: boolean; onOpenChange: (open: boolean) => void; title: string; hint?: string; onUnlocked: () => void }) {
  const { t } = useI18n();
  const { unlock, busy, lockedOut, padError, signOutWarning } = usePinUnlock({
    onUnlocked: () => {
      onOpenChange(false);
      onUnlocked();
    },
  });
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={title} testId="pin-dialog">
      {hint ? <p className="cc-muted">{hint}</p> : null}
      <PinPad onSubmit={unlock} busy={busy} disabled={lockedOut} error={padError} />
      {signOutWarning !== null ? (
        <p className="cc-alert cc-alert--warning" role="status">
          {t('pin.signOutWarning', { count: signOutWarning })}
        </p>
      ) : null}
      <DialogActions>
        <Button onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
      </DialogActions>
    </Modal>
  );
}
