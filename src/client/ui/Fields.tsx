import { useId, type ReactNode, type Ref } from 'react';
import { FieldError, Input, Label, Switch, Text, TextArea as RACTextArea, TextField as RACTextField, type TextFieldProps as RACTextFieldProps } from 'react-aria-components';
import { useI18n } from '../lib/i18n.tsx';

export interface TextFieldProps extends Omit<RACTextFieldProps, 'className' | 'children'> {
  label: string;
  description?: string;
  errorMessage?: string | null;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

/** Labelled text input; the error is text + border weight, never colour only (UX-7). */
export function TextField({ label, description, errorMessage, placeholder, className = '', inputClassName = '', ...rest }: TextFieldProps) {
  return (
    <RACTextField {...rest} isInvalid={Boolean(errorMessage) || rest.isInvalid} className={`cc-field ${className}`}>
      <Label className="cc-field__label">{label}</Label>
      <Input className={`cc-input ${inputClassName}`} placeholder={placeholder} />
      {description ? (
        <Text slot="description" className="cc-field__hint">
          {description}
        </Text>
      ) : null}
      <FieldError className="cc-field__error">{errorMessage ? `⚠ ${errorMessage}` : null}</FieldError>
    </RACTextField>
  );
}

/**
 * Labelled multi-line text input (pasted lists, notes). Same field chrome as TextField. `inputRef`
 * reaches the textarea itself (S14d: a sentence starter selects its blank).
 */
export function TextArea({ label, description, errorMessage, placeholder, rows = 8, className = '', inputRef, ...rest }: TextFieldProps & { rows?: number; inputRef?: Ref<HTMLTextAreaElement> }) {
  return (
    <RACTextField {...rest} isInvalid={Boolean(errorMessage) || rest.isInvalid} className={`cc-field ${className}`}>
      <Label className="cc-field__label">{label}</Label>
      <RACTextArea ref={inputRef} className="cc-input cc-textarea" placeholder={placeholder} rows={rows} />
      {description ? (
        <Text slot="description" className="cc-field__hint">
          {description}
        </Text>
      ) : null}
      <FieldError className="cc-field__error">{errorMessage ? `⚠ ${errorMessage}` : null}</FieldError>
    </RACTextField>
  );
}

export interface SelectItem {
  id: string;
  label: string;
  disabled?: boolean;
}

/**
 * Select built on the native <select>: fully keyboard/touch accessible, works with every screen
 * reader and the on-screen keyboards of classroom touch panels.
 */
export function Select({
  label,
  items,
  value,
  onChange,
  description,
  name,
  disabled,
  placeholder,
  className = '',
  hideLabel = false,
}: {
  label: string;
  items: SelectItem[];
  value: string;
  onChange: (v: string) => void;
  description?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Keep the label for screen readers only (e.g. one select per table row under a column header). */
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={`cc-field ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'cc-visually-hidden' : 'cc-field__label'}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        className="cc-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={description ? `${id}-d` : undefined}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {items.map((i) => (
          <option key={i.id} value={i.id} disabled={i.disabled}>
            {i.label}
          </option>
        ))}
      </select>
      {description ? (
        <span id={`${id}-d`} className="cc-field__hint">
          {description}
        </span>
      ) : null}
    </div>
  );
}

/** On/off switch with a visible "On"/"Off" state label (not colour only). */
export function Toggle({
  label,
  isSelected,
  onChange,
  isDisabled,
  description,
}: {
  label: ReactNode;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
  description?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="cc-field">
      <Switch isSelected={isSelected} onChange={onChange} isDisabled={isDisabled} className="cc-switch">
        <span className="cc-switch__track" aria-hidden="true">
          <span className="cc-switch__thumb" />
        </span>
        <span>{label}</span>
        <span className="cc-switch__state" aria-hidden="true">
          {isSelected ? t('common.on') : t('common.off')}
        </span>
      </Switch>
      {description ? <span className="cc-field__hint">{description}</span> : null}
    </div>
  );
}
