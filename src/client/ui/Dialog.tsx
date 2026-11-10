import { useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal as RACModal, ModalOverlay } from 'react-aria-components';
import { lowerTr } from '../../shared/text/turkish.ts';
import { clearManualCopy, copyText, useManualCopy } from '../lib/clipboard.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { TextField } from './Fields.tsx';
import { FrameOverlay } from './Frame.tsx';
import { IconAlert, IconCheck, IconCopy, IconX } from './icons.tsx';

/** Accessible modal dialog (focus trap; Escape / outside press close unless `dismissable` is false). */
export function Modal({
  isOpen,
  onOpenChange,
  title,
  children,
  dismissable = true,
  role = 'dialog',
  size = 'normal',
  testId,
  closeButton = false,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  dismissable?: boolean;
  role?: 'dialog' | 'alertdialog';
  /**
   * 'wide' for grids (homework checking), 'full' for full-screen classroom screens (groups, S13a),
   * 'drawer' for a full-height panel at the end side of the screen (student statistics, S14e2).
   */
  size?: 'normal' | 'wide' | 'full' | 'drawer';
  testId?: string;
  /** A Close button next to the title, for long dialogs whose own buttons are at the end (D-139). */
  closeButton?: boolean;
}) {
  const { t } = useI18n();
  const heading = (
    <Heading slot="title" className="cc-h2">
      {title}
    </Heading>
  );
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={dismissable} isKeyboardDismissDisabled={!dismissable} className={`cc-modal-overlay cc-modal-overlay--${size}`}>
      <RACModal className={`cc-modal cc-modal--${size}`} data-testid={testId}>
        {/* Theme frame (S17a, D-166), drawn inside the dialog's top edge; not on full-screen views. */}
        {size === 'normal' || size === 'wide' ? <FrameOverlay surface="dialogs" /> : null}
        <Dialog className="cc-dialog" role={role}>
          {closeButton ? (
            <div className="cc-dialog__head">
              {heading}
              <Button size="small" onPress={() => onOpenChange(false)} data-testid="dialog-close">
                <IconX />
                {t('common.close')}
              </Button>
            </div>
          ) : (
            heading
          )}
          {children}
        </Dialog>
      </RACModal>
    </ModalOverlay>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="cc-dialog__actions">{children}</div>;
}

/**
 * Destructive confirmation (DAT-5): the user must type `confirmText` (e.g. the account or class
 * name) before the action button enables. Turkish-aware, case-insensitive comparison.
 */
export function ConfirmDestructive({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmText,
  actionLabel,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmText: string;
  actionLabel: string;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = lowerTr(typed.trim()) === lowerTr(confirmText.trim());
  const close = (open: boolean) => {
    if (!open) {
      setTyped('');
      setError(null);
    }
    onOpenChange(open);
  };
  return (
    <Modal isOpen={isOpen} onOpenChange={close} title={title} role="alertdialog">
      <div className="cc-alert cc-alert--warning">
        <IconAlert />
        <div>{description}</div>
      </div>
      {/* Field and buttons stay visible at the bottom when a long warning scrolls (phones). */}
      <div className="cc-dialog__footer">
        <TextField label={t('confirm.typeToConfirm', { text: confirmText })} value={typed} onChange={setTyped} autoFocus autoComplete="off" />
        {error ? (
          <p role="alert" className="cc-field__error">
            ⚠ {error}
          </p>
        ) : null}
        <DialogActions>
          <Button onPress={() => close(false)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            isDisabled={!matches || busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                close(false);
              } catch (err) {
                setError(errorText(t, err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {actionLabel}
          </Button>
        </DialogActions>
      </div>
    </Modal>
  );
}

/**
 * Shown when the browser could not copy a text (a plain-HTTP school network has no Clipboard API):
 * the text in a read-only field that is selected at once, so the teacher copies it by hand. Mount
 * once at the root; open it with `showManualCopy` (`lib/clipboard.ts`).
 */
export function ManualCopyDialog() {
  const { t } = useI18n();
  const m = useManualCopy();
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    clearManualCopy();
  };
  if (!m) return null;
  return (
    <Modal isOpen onOpenChange={(o) => !o && close()} title={m.title} testId="manual-copy">
      <p>{t('copy.manualHint')}</p>
      <TextField
        label={m.label}
        value={m.text}
        isReadOnly
        autoFocus
        onFocus={(e) => (e.target as HTMLInputElement).select()}
        inputClassName="cc-manual-copy__input"
      />
      <DialogActions>
        <Button
          onPress={async () => {
            setCopied(await copyText(m.text));
          }}
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? t('copy.done') : t('copy.tryAgain')}
        </Button>
        <Button variant="primary" onPress={close}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Modal>
  );
}
