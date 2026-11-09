/**
 * Size budget of the personal student page (S14d, D-151). Students open their page on cheap phones
 * over school or home Wi-Fi, so the entry must stay small: no new libraries in the student bundle.
 *
 * Reads the built `dist/client/student.html` and adds up the gzip size of everything the page loads
 * before it can render: the entry script, every `modulepreload` chunk and the stylesheets (lazy chunks
 * such as Help are not counted; they load only when used). Fails (exit code 1) when the total or the
 * page's own entry chunk is over budget. Run by `npm run build` after `vite build`.
 *
 *   node scripts/student-budget.ts            check against the budget
 *   node scripts/student-budget.ts --report   print every file and its size too
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Budgets in gzip bytes (D-151). Measured on 2026-11-09: 396 kB in total before S14d, 404 kB after it
 * and 417 kB with S14g's theme packages (React 64 kB, the UI primitives 52 kB, Zod 56 kB, TanStack
 * 36 kB, the whole EN+TR dictionary 98 kB, which every stage's strings make larger, the shared app
 * chunk 41 kB, the stylesheet 17 kB), and 16 kB → 19 kB for the student entry itself. The budgets
 * leave about 10 % and 35 % room. Raise a budget only with a DECISIONS entry that says why.
 */
export const STUDENT_BUDGET = { total: 460_000, entry: 26_000 } as const;

export interface BudgetFile {
  path: string;
  gzip: number;
  entry: boolean;
}

/** The files `student.html` loads before the page can render (entry, module preloads, stylesheets). */
export function studentFiles(dir: string): BudgetFile[] {
  const html = readFileSync(join(dir, 'student.html'), 'utf8');
  const out: BudgetFile[] = [];
  const seen = new Set<string>();
  const add = (href: string, entry: boolean) => {
    if (!href.startsWith('/assets/') || seen.has(href)) return;
    seen.add(href);
    out.push({ path: href, gzip: gzipSync(readFileSync(join(dir, href)), { level: 9 }).length, entry });
  };
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gu)) add(m[1]!, true);
  for (const m of html.matchAll(/<link[^>]*\srel="(?:modulepreload|stylesheet)"[^>]*\shref="([^"]+)"/gu)) add(m[1]!, false);
  return out;
}

export function checkBudget(files: readonly BudgetFile[], budget: { total: number; entry: number } = STUDENT_BUDGET): string[] {
  const problems: string[] = [];
  const total = files.reduce((n, f) => n + f.gzip, 0);
  const entry = files.filter((f) => f.entry).reduce((n, f) => n + f.gzip, 0);
  if (!files.some((f) => f.entry)) problems.push('student.html loads no entry script');
  if (total > budget.total) problems.push(`student page total ${total} B gzip is over the budget of ${budget.total} B`);
  if (entry > budget.entry) problems.push(`student entry ${entry} B gzip is over the budget of ${budget.entry} B`);
  return problems;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/').split('/').pop()!);
if (isMain) {
  const dir = join(process.cwd(), 'dist', 'client');
  if (!existsSync(join(dir, 'student.html'))) {
    console.error('student-budget: dist/client/student.html not found; run `vite build` first');
    process.exit(1);
  }
  const files = studentFiles(dir);
  const total = files.reduce((n, f) => n + f.gzip, 0);
  const entry = files.filter((f) => f.entry).reduce((n, f) => n + f.gzip, 0);
  if (process.argv.includes('--report')) for (const f of [...files].sort((a, b) => b.gzip - a.gzip)) console.log(`${String(f.gzip).padStart(8)}  ${f.path}${f.entry ? '  (entry)' : ''}`);
  console.log(`student page: ${(total / 1000).toFixed(1)} kB gzip (budget ${STUDENT_BUDGET.total / 1000} kB), entry ${(entry / 1000).toFixed(1)} kB (budget ${STUDENT_BUDGET.entry / 1000} kB)`);
  const problems = checkBudget(files);
  for (const p of problems) console.error(`student-budget: ${p}`);
  if (problems.length) process.exit(1);
}
