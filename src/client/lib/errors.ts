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
