import type { ReactNode } from 'react';
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'small' | 'md' | 'big';

export interface ButtonProps extends Omit<RACButtonProps, 'className' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') =>
  `cc-btn cc-btn--${variant} cc-btn--${size} ${extra}`.trim();

/** Touch-first button (React Aria handles press on touch, mouse, keyboard; no hover reliance). */
export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <RACButton {...rest} className={buttonClass(variant, size, className)}>
      {children}
    </RACButton>
  );
}

/** Extra-large button for the most common classroom actions (UX-8). */
export function BigButton(props: Omit<ButtonProps, 'size'>) {
  return <Button {...props} size="big" />;
}

/**
 * Icon + text button. The text label is visible by default; `hideLabel` keeps it for screen readers
 * only (aria-label) — never a hover tooltip (UX-7).
 */
export function IconButton({
  icon,
  label,
  hideLabel = false,
  ...rest
}: Omit<ButtonProps, 'children' | 'aria-label'> & { icon: ReactNode; label: string; hideLabel?: boolean }) {
  return (
    <Button {...rest} aria-label={hideLabel ? label : undefined}>
      {icon}
      {hideLabel ? null : <span>{label}</span>}
    </Button>
  );
}
