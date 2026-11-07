import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type Locale, type MessageKey } from '../../shared/i18n/index.ts';

interface I18n {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n>({ locale: 'en', t: (k, v) => translate('en', k, v) });

/** Locale comes from the signed-in teacher's own preference (UX-4), never a device-global setting. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, t: (k, v) => translate(locale, k, v) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
