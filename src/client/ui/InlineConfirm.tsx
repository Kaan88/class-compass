/**
 * An in-page "Are you sure?" (S14d, D-151) instead of `window.confirm`, which is small, unstyled and
 * easy to tap past on a phone (and blocked in some embedded browsers). The question and two big
 * buttons appear in place of the button that asked; the safe answer has the focus, and the focus goes
 * back to the asking button when the answer is No. For the serious, typed confirmations of the teacher
 * and admin areas keep using `ConfirmDestructive`.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button.tsx';

export interface InlineConfirmProps {
  /** The question ("Delete this? You cannot get it back."). */
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Draws the Yes button as a destructive action. */
  destructive?: boolean;
}

/** The question with Yes / No. Focuses No (the safe answer) when it appears. */
export function InlineConfirm({ message, confirmLabel, cancelLabel, onConfirm, onCancel, destructive = false }: InlineConfirmProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-inline-confirm="no"]')?.focus();
  }, []);
  return (
    <div ref={box} className="cc-inline-confirm" role="group" aria-labelledby={id} data-testid="inline-confirm">
      <p id={id} className="cc-inline-confirm__message">
        {message}
      </p>
      <div className="cc-inline-confirm__actions">
        <Button variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} data-inline-confirm="yes">
          {confirmLabel}
        </Button>
        <Button onPress={onCancel} data-inline-confirm="no">
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

/** A button that asks first: pressing it shows the question in its place. */
export function InlineConfirmButton({
  children,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = true,
  ...button
}: Omit<ButtonProps, 'onPress' | 'children'> & Omit<InlineConfirmProps, 'onCancel'> & { children: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!asking && returnFocus.current) {
      returnFocus.current = false;
      wrap.current?.querySelector('button')?.focus();
    }
  }, [asking]);
  return (
    <div ref={wrap} className="cc-inline-confirm__wrap">
      {asking ? (
        <InlineConfirm
          message={message}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          destructive={destructive}
          onConfirm={() => {
            setAsking(false);
            onConfirm();
          }}
          onCancel={() => {
            returnFocus.current = true;
            setAsking(false);
          }}
        />
      ) : (
        <Button {...button} onPress={() => setAsking(true)}>
          {children}
        </Button>
      )}
    </div>
  );
}
