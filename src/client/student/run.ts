/**
 * The save runner of the student screens (S14d, D-151), on its own since S26c (D-191): My goals (part
 * of the page's first load) needs only this, while the text checks in `common.tsx` belong to the
 * writing screens, which are lazy chunks.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRun } from '../lib/useRun.ts';
import { STUDENT_PAGE_KEY } from './keys.ts';

/** Run a student action and refresh the page (a revoked link then shows the "no longer works" page). */
export function useStudentRun() {
  const run = useRun();
  const qc = useQueryClient();
  return async <T>(fn: () => Promise<T>, success?: string) => {
    const r = await run(fn, success ? { success } : {});
    void qc.invalidateQueries({ queryKey: STUDENT_PAGE_KEY });
    return r;
  };
}
