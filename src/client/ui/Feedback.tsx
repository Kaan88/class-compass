/**
 * Feedback components: Toaster/UndoToast (UX-9), SaveStateBadge (UX-10), NeedsAttentionTray (UX-11),
 * EmptyState.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import type { OutboxOp } from '../lib/outbox.ts';
import { isRetryable, saveStateOf, type SaveState } from '../lib/outbox.ts';
import { commandErrorText } from '../lib/errors.ts';
import { getOutbox, useOutboxStatus } from '../lib/outbox-client.ts';
import { dismissToast, useToasts, type Toast } from '../lib/toast.ts';
import { Button } from './Button.tsx';
import { IconAlert, IconCheck, IconCloudOff, IconSync, IconUndo, IconX } from './icons.tsx';
import { Mascot } from './Mascot.tsx';

function ToastView({ toast }: { toast: Toast }) {
  const { t } = useI18n();
  const [left, setLeft] = useState(Math.ceil(toast.durationMs / 1000));
  useEffect(() => {
    if (!toast.undo) return;
    const h = setInterval(() => setLeft(Math.max(0, Math.ceil((toast.createdAt + toast.durationMs - Date.now()) / 1000))), 500);
    return () => clearInterval(h);
  }, [toast]);
  return (
    <div className="cc-toast" data-kind={toast.kind} data-testid="toast">
      {toast.kind === 'error' ? <IconAlert /> : toast.kind === 'success' ? <IconCheck /> : null}
      <span className="cc-toast__msg">{toast.message}</span>
      {toast.undo ? (
        <>
          <span className="cc-toast__timer" aria-hidden="true">
            {t('toast.secondsLeft', { count: left })}
          </span>
          <Button
            size="small"
            onPress={async () => {
              dismissToast(toast.id);
              await toast.undo?.();
            }}
          >
            <IconUndo />
            {t('common.undo')}
          </Button>
        </>
      ) : null}
      <Button size="small" variant="ghost" aria-label={t('common.close')} onPress={() => dismissToast(toast.id)}>
        <IconX />
      </Button>
    </div>
  );
}

/** Mount once at the root. Polite live region so screen readers hear confirmations. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="cc-toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>
  );
}

/** Saving / saved / offline (n waiting) / error — icon + text, never colour only (UX-10). */
export function SaveStateBadge({ state }: { state: SaveState }) {
  const { t } = useI18n();
  const kind = state.kind === 'idle' ? 'saved' : state.kind;
  const icon = kind === 'saving' ? <IconSync /> : kind === 'saved' ? <IconCheck /> : kind === 'offline' ? <IconCloudOff /> : <IconAlert />;
  const text =
    state.kind === 'saving'
      ? t('save.saving')
      : state.kind === 'offline'
        ? t('save.offline', { count: state.count })
        : state.kind === 'error'
          ? t('save.error')
          : t('save.saved');
  return (
    <span className="cc-save" data-state={kind} role="status" aria-live="polite">
      {icon}
      <span>{text}</span>
    </span>
  );
}

/** SaveStateBadge bound to the app's command outbox. */
export function OutboxSaveBadge() {
  const status = useOutboxStatus();
  return <SaveStateBadge state={saveStateOf(status)} />;
}

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  /** False when re-sending could apply the action twice: only Dismiss is offered. */
  canRetry?: boolean;
}

/** Commands the server refused; never silently dropped (UX-11). */
export function NeedsAttentionTray({ items, onRetry, onDismiss }: { items: AttentionItem[]; onRetry: (id: string) => void; onDismiss: (id: string) => void }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-attention-title" role="region">
      <h2 id="cc-attention-title" className="cc-h2 cc-row">
        <IconAlert />
        {t('attention.title', { count: items.length })}
      </h2>
      <p className="cc-muted">{t('attention.explain')}</p>
      <ul className="cc-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.id} className="cc-row cc-alert cc-alert--danger">
            <div style={{ flex: 1 }}>
              <div>{i.title}</div>
              <div className="cc-muted">{i.detail}</div>
            </div>
            {i.canRetry === false ? null : (
              <Button size="small" variant="primary" onPress={() => onRetry(i.id)}>
                {t('attention.retry')}
              </Button>
            )}
            <Button size="small" onPress={() => onDismiss(i.id)}>
              {t('attention.dismiss')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Command types register a human description here (S5+); unknown types get a generic label. */
const describers = new Map<string, (op: OutboxOp) => string>();
export function registerCommandDescription(type: string, fn: (op: OutboxOp) => string) {
  describers.set(type, fn);
}

/** NeedsAttentionTray bound to the outbox's rejected commands. */
export function OutboxAttentionTray() {
  const { t } = useI18n();
  const status = useOutboxStatus();
  const items = status.rejected.map((op) => ({
    id: op.opId,
    title: describers.get(op.type)?.(op) ?? t('attention.unknownAction', { type: op.type }),
    detail: commandErrorText(t, op.error),
    canRetry: isRetryable(op),
  }));
  return <NeedsAttentionTray items={items} onRetry={(id) => void getOutbox().retry(id)} onDismiss={(id) => void getOutbox().dismiss(id)} />;
}

export function EmptyState({ title, body, action, mascot = true }: { title: string; body?: ReactNode; action?: ReactNode; mascot?: boolean }) {
  return (
    <div className="cc-card cc-stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      {mascot ? <Mascot size={96} /> : null}
      <h2 className="cc-h2">{title}</h2>
      {body ? <div className="cc-muted">{body}</div> : null}
      {action}
    </div>
  );
}

/** Inline alert box with an icon (errors, warnings, confirmations). */
export function Alert({ kind = 'danger', children }: { kind?: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  return (
    <div className={`cc-alert cc-alert--${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      {kind === 'success' ? <IconCheck /> : <IconAlert />}
      <div>{children}</div>
    </div>
  );
}
