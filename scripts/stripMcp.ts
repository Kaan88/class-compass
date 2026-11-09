/**
 * Keeps the AI tools metadata out of the browser bundles (S14i, D-151 bundle note, D-160).
 *
 * An endpoint becomes an MCP tool by declaring `mcp: { scope, tool, description, readOnly, cost? }` on
 * its shared contract (D-160). Only the server reads it, but the contracts are shared, so every client
 * entry that imports a contract file (the student page imports `goals.ts` and `school.ts`) carried the
 * long tool descriptions written for AI clients. This Vite plugin removes the `mcp: {…}` property from
 * `src/shared/contracts/*.ts` before the client is bundled; the server runs the sources unchanged.
 *
 * The scanner looks for `mcp:` in property position (after `{`, `,` or a line start) and reads the
 * object literal to its closing brace, skipping strings, template literals and comments. The values
 * of an exposure are plain literals (strings, booleans, numbers), so no regular expression literal can
 * appear inside one. `npm run build` checks the student page for leftovers (`scripts/student-budget.ts`).
 */
import type { Plugin } from 'vite';

const PROPERTY = /(^|[{,]\s*|\n[ \t]*)mcp\s*:\s*\{/gu;

/** Index just after the `}` that closes the object literal whose `{` is at `open`, or -1. */
function closingBrace(code: string, open: number): number {
  let depth = 0;
  const templates: number[] = []; // brace depth at which each open `${` of a template literal started
  let i = open;
  while (i < code.length) {
    const c = code[i]!;
    if (c === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      i = end < 0 ? code.length : end;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i += 1;
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') i += 1;
        if (code[i] === '\n') return -1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '`' || (c === '}' && templates.length > 0 && templates[templates.length - 1] === depth)) {
      if (c === '}') templates.pop();
      i += 1;
      // Inside a template literal: up to its end or the next `${`.
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') i += 2;
        else if (code[i] === '$' && code[i + 1] === '{') {
          templates.push(depth);
          i += 2;
          break;
        } else i += 1;
      }
      if (code[i] === '`') i += 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/** The source with every `mcp: {…}` property removed (with its trailing comma). Throws when one cannot be read. */
export function stripMcpExposures(code: string): string {
  let out = '';
  let from = 0;
  PROPERTY.lastIndex = 0;
  for (let m = PROPERTY.exec(code); m; m = PROPERTY.exec(code)) {
    if (m.index < from) continue;
    const start = m.index + m[1]!.length;
    const open = m.index + m[0].length - 1;
    const end = closingBrace(code, open);
    if (end < 0) throw new Error(`stripMcpExposures: unterminated mcp exposure at offset ${start}`);
    let next = end;
    while (next < code.length && /[ \t]/u.test(code[next]!)) next += 1;
    if (code[next] === ',') next += 1;
    // Keep the line breaks of a multi-line exposure, so the lines after it keep their numbers.
    out += code.slice(from, start) + code.slice(start, next).replace(/[^\n]/gu, '');
    from = next;
    PROPERTY.lastIndex = next;
  }
  return out + code.slice(from);
}

const CONTRACT_FILE = /[\\/]src[\\/]shared[\\/]contracts[\\/][^\\/]+\.ts$/u;

/** Vite plugin: strips the MCP exposures from the shared contracts in client builds. */
export function stripMcpPlugin(): Plugin {
  return {
    name: 'cc-strip-mcp-exposures',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]!;
      if (!CONTRACT_FILE.test(file) || !code.includes('mcp')) return null;
      const stripped = stripMcpExposures(code);
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}
