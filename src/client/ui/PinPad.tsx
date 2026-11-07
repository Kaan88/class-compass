import { useId, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { IconAlert, IconBackspace, IconUnlock } from './icons.tsx';

/**
 * PIN entry for touch screens and keyboards (PIN-2): large digit keys (no hover), a masked input
 * that also accepts typing, and a clear error/lockout message area.
 */
export function PinPad({
  onSubmit,
  busy = false,
  error,
  disabled = false,
  minLength = 4,
  maxLength = 8,
  submitLabel,
  autoFocus = true,
}: {
  onSubmit: (pin: string) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [pin, setPin] = useState('');
  const canSubmit = pin.length >= minLength && !busy && !disabled;
  const press = (d: string) => setPin((p) => (p.length < maxLength ? p + d : p));
  const submit = async () => {
    if (!canSubmit) return;
    const value = pin;
    setPin('');
    await onSubmit(value);
  };
  return (
    <form
      className="cc-pinpad"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="cc-field__label">
        {t('pin.enter')}
      </label>
      <input
        id={id}
        className="cc-input"
        style={{ fontSize: '2rem', textAlign: 'center', letterSpacing: '0.4em', width: '100%' }}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={maxLength}
        value={pin}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, maxLength))}
        autoFocus={autoFocus}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="cc-alert cc-alert--danger" style={{ width: '100%', boxSizing: 'border-box' }}>
          <IconAlert />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="cc-pinpad__keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button key={d} className="cc-pinpad__key" onPress={() => press(d)} isDisabled={disabled || busy}>
            {d}
          </Button>
        ))}
        <Button className="cc-pinpad__key" aria-label={t('pin.delete')} onPress={() => setPin((p) => p.slice(0, -1))} isDisabled={disabled || busy || pin.length === 0}>
          <IconBackspace />
        </Button>
        <Button className="cc-pinpad__key" onPress={() => press('0')} isDisabled={disabled || busy}>
          0
        </Button>
        <Button className="cc-pinpad__key" variant="primary" type="submit" aria-label={submitLabel ?? t('pin.unlock')} isDisabled={!canSubmit}>
          <IconUnlock />
        </Button>
      </div>
    </form>
  );
}
