/**
 * Audit log codes in words (usability audit 2026-11): every action and record type the server writes
 * has an `audit.action.<code>` / `audit.entity.<code>` key in both dictionaries (test-enforced in
 * tests/client/admin-usability.test.tsx). A code without a key (an older or newer server) is shown as it is.
 */
import { hasMessage, translate, type Locale } from '../../../shared/i18n/index.ts';

export function auditLabel(locale: Locale, kind: 'action' | 'entity', code: string): string {
  const key = `audit.${kind}.${code}`;
  return hasMessage(key) ? translate(locale, key) : code;
}
