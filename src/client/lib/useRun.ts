import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { errorText } from './errors.ts';
import { useI18n } from './i18n.tsx';
import { showToast } from './toast.ts';

/**
 * Run an API action from a button: shows a translated error toast on failure (UX-10), optional
 * success toast, and invalidates the given queries. Resolves to undefined on failure.
 */
export function useRun() {
  const { t } = useI18n();
  const qc = useQueryClient();
  return async function run<T>(fn: () => Promise<T>, opts: { success?: string; invalidate?: QueryKey[] } = {}): Promise<T | undefined> {
    try {
      const r = await fn();
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
      if (opts.success) showToast({ message: opts.success, kind: 'success' });
      return r;
    } catch (err) {
      showToast({ message: errorText(t, err), kind: 'error' });
      return undefined;
    }
  };
}
