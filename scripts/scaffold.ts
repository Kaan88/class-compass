/**
 * Shared helpers of the scaffolding scripts (`npm run new:module`, `npm run new:theme`; SX, D-069,
 * D-070). A scaffold is planned in memory as a list of file creations and edits against a project
 * root, then printed (`--dry-run`) or written. Edits insert text at anchors in the registry files and
 * fail loudly when an anchor is missing, so a changed registry layout never yields a half-applied
 * scaffold. See docs/EXTENDING.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface Change {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  kind: 'create' | 'update';
  content: string;
}

export interface CliOptions {
  key: string;
  root: string;
  dryRun: boolean;
}

/** Keys are camelCase identifiers: they become i18n prefixes, folder names and TS identifiers. */
export const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{1,30}$/;

export function parseArgs(argv: readonly string[], usage: string): CliOptions {
  let key: string | undefined;
  let root = process.cwd();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--root') {
      const v = argv[++i];
      if (!v) throw new Error(`--root needs a directory\n${usage}`);
      root = resolve(v);
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}\n${usage}`);
    else if (key === undefined) key = a;
    else throw new Error(`Unexpected argument ${a}\n${usage}`);
  }
  if (!key) throw new Error(usage);
  if (!KEY_PATTERN.test(key)) throw new Error(`"${key}" is not a camelCase key (letters and digits, starting with a lower-case letter)`);
  return { key, root, dryRun };
}

export const pascal = (key: string) => key[0]!.toUpperCase() + key.slice(1);
/** `homeworkTracker` → `Homework tracker` (a starting label; translators replace it). */
export const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words[0]!.toUpperCase() + words.slice(1);
};
/** A string literal for generated TS source (single quotes, escaped). */
export const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** In-memory view of the project: reads see earlier planned edits; nothing touches disk until `apply`. */
export function workspace(root: string) {
  const pending = new Map<string, Change>();
  const read = (rel: string): string => {
    const p = pending.get(rel);
    if (p) return p.content;
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`Missing ${rel} under ${root}`);
    return readFileSync(abs, 'utf8');
  };
  return {
    root,
    read,
    exists: (rel: string) => pending.has(rel) || existsSync(join(root, rel)),
    create(rel: string, content: string) {
      if (pending.has(rel) || existsSync(join(root, rel))) throw new Error(`${rel} already exists`);
      pending.set(rel, { path: rel, kind: 'create', content });
    },
    /** Inserts `text` right before the first occurrence of `anchor` (after `after`, when given). */
    insertBefore(rel: string, anchor: string, text: string, after?: string) {
      const src = read(rel);
      const from = after === undefined ? 0 : src.indexOf(after);
      if (from < 0) throw new Error(`Anchor ${JSON.stringify(after)} not found in ${rel}`);
      const at = src.indexOf(anchor, from);
      if (at < 0) throw new Error(`Anchor ${JSON.stringify(anchor)} not found in ${rel}`);
      const kind = pending.get(rel)?.kind ?? 'update';
      pending.set(rel, { path: rel, kind, content: src.slice(0, at) + text + src.slice(at) });
    },
    replace(rel: string, pattern: RegExp, by: (m: string, ...groups: string[]) => string) {
      const src = read(rel);
      if (!pattern.test(src)) throw new Error(`Pattern ${pattern} not found in ${rel}`);
      const kind = pending.get(rel)?.kind ?? 'update';
      pending.set(rel, { path: rel, kind, content: src.replace(pattern, by) });
    },
    changes: (): Change[] => [...pending.values()],
  };
}
export type Workspace = ReturnType<typeof workspace>;

/** Writes the planned changes (or only lists them with `dryRun`). Returns the printed summary. */
export function apply(root: string, changes: readonly Change[], dryRun: boolean): string {
  const lines = changes.map((c) => `${dryRun ? 'would ' : ''}${c.kind} ${c.path}`);
  if (!dryRun) {
    for (const c of changes) {
      const abs = join(root, c.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, c.content);
    }
  }
  return lines.join('\n');
}

/** The main dictionary (what the student page loads) and the staff dictionary (everything else), S23a / D-182. */
const DICTIONARIES = {
  main: { en: 'src/shared/i18n/en.ts', tr: 'src/shared/i18n/tr.ts', trEnd: '} as const satisfies Messages;' },
  staff: { en: 'src/shared/i18n/areas/staff/en.ts', tr: 'src/shared/i18n/areas/staff/tr.ts', trEnd: '} as const satisfies StaffMessages;' },
} as const;

/**
 * Adds keys in English and Turkish. Turkish gets the English text marked for translation. `dict` is
 * `main` only for strings the student page shows (`module.<key>`, `theme.<key>`; D-182), else `staff`.
 */
export function addMessages(ws: Workspace, entries: ReadonlyArray<readonly [key: string, en: string]>, dict: keyof typeof DICTIONARIES = 'staff') {
  const { en, tr, trEnd } = DICTIONARIES[dict];
  for (const [k] of entries)
    for (const d of Object.values(DICTIONARIES)) if (ws.read(d.en).includes(`${lit(k)}:`)) throw new Error(`i18n key ${k} already exists`);
  ws.insertBefore(en, '} as const;', entries.map(([k, v]) => `  ${lit(k)}: ${lit(v)},\n`).join(''));
  ws.insertBefore(tr, trEnd, entries.map(([k, v]) => `  ${lit(k)}: ${lit(v)}, // TODO(tr): translate\n`).join(''));
}

/** Runs a scaffold CLI: parse, plan, print, write. */
export function runCli(usage: string, plan: (ws: Workspace, key: string) => void, after: (key: string) => string): void {
  try {
    const opts = parseArgs(process.argv.slice(2), usage);
    const ws = workspace(opts.root);
    plan(ws, opts.key);
    console.log(apply(opts.root, ws.changes(), opts.dryRun));
    if (!opts.dryRun) console.log(`\n${after(opts.key)}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
