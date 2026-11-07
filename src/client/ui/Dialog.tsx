import { useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal as RACModal, ModalOverlay } from 'react-aria-components';
import { lowerTr } from '../../shared/text/turkish.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { TextField } from './Fields.tsx';
import { IconAlert } from './icons.tsx';

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
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  dismissable?: boolean;
  role?: 'dialog' | 'alertdialog';
  /** 'wide' for grids (homework checking), 'full' for full-screen classroom screens (groups, S13a). */
  size?: 'normal' | 'wide' | 'full';
  testId?: string;
}) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={dismissable} isKeyboardDismissDisabled={!dismissable} className={`cc-modal-overlay cc-modal-overlay--${size}`}>
      <RACModal className={`cc-modal cc-modal--${size}`} data-testid={testId}>
        <Dialog className="cc-dialog" role={role}>
          <Heading slot="title" className="cc-h2">
            {title}
          </Heading>
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
    </Modal>
  );
}
