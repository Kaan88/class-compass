import type { MessageKey } from '../../shared/i18n/index.ts';
import { en } from '../../shared/i18n/en.ts';
import { ApiError } from './api.ts';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const isKey = (k: string): k is MessageKey => k in en;

/**
 * User-facing text for an API error: a translated business reason (`details.reason`) when there is
 * one, else a translated error code, else a generic message. Never shows stack traces.
 */
export function errorText(t: T, err: unknown): string {
  if (err instanceof ApiError) {
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === 'string' && isKey(`error.${reason}`)) return t(`error.${reason}` as MessageKey);
    if (isKey(`error.${err.code}`)) return t(`error.${err.code}` as MessageKey);
    return t('common.error');
  }
  if (err instanceof TypeError) return t('error.NETWORK');
  return t('common.error');
}

export const reasonOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? ((err.details as { reason?: string } | undefined)?.reason ?? undefined) : undefined;

/**
 * User-facing text for a command the server rejected (Needs-attention tray, UX-3): the translated
 * reason, else the translated code, else a generic message. The server's English `message` is for
 * diagnostics only and is never shown.
 */
export function commandErrorText(t: T, error: { code: string; reason?: string | undefined } | undefined): string {
  if (error?.reason && isKey(`error.${error.reason}`)) return t(`error.${error.reason}` as MessageKey);
  if (error?.code && isKey(`error.${error.code}`)) return t(`error.${error.code}` as MessageKey);
  return t('common.error');
}
