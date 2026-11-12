/**
 * MCP resources (S14h1, D-160): the user guides (English and Turkish), the theming guide, the theme
 * package schema and "my classes". Documents are read from `docs/` next to the server (the Docker
 * image copies them); a missing file is simply not listed. Everything passes the privacy gate like a
 * tool result.
 *
 * S16b (D-164): every `docs/examples/*.theme.json` is a resource too (the worked `ocean` example and
 * one generated package per built-in theme), and Markdown documents are served with their
 * repository-relative links rewritten (`linkDocs`): a link to a document that is a resource becomes
 * its `classcompass://` URI, any other link becomes plain text naming the repository file. The files
 * in git stay unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LocalizedText, pii } from '../../../shared/contracts/define.ts';
import * as S from '../../../shared/contracts/school.ts';
import { isLocale, LANGUAGES, LOCALES } from '../../../shared/languages.ts';
import type { McpScope } from '../../../shared/mcp.ts';
import { THEME_KEYS } from '../../../shared/themes.ts';
import { themePackageJsonSchema } from '../../../shared/themePackage/schema.ts';
import { callEndpoint, type ToolEnv, type ToolRole } from './toolkit.ts';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs');
export const RESOURCE_SCHEME = 'classcompass://';

export interface McpResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  scope: McpScope | null;
  role: ToolRole;
  /** The allow-list schema with `pii()` marks (static documents are `none`). */
  output: z.ZodType;
  read: (env: ToolEnv) => Promise<unknown> | unknown;
}

const readDoc = (rel: string) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const EXAMPLE_SUFFIX = '.theme.json';

/** The example theme packages in docs/examples (file stem → read). */
export function exampleKeys(): string[] {
  const dir = path.join(DOCS, 'examples');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(EXAMPLE_SUFFIX))
    .map((f) => f.slice(0, -EXAMPLE_SUFFIX.length))
    .sort();
}
/** An example package as parsed JSON, or null when there is no such file. */
export function readExample(key: string): Record<string, unknown> | null {
  if (!exampleKeys().includes(key)) return null;
  return JSON.parse(readDoc(`examples/${key}${EXAMPLE_SUFFIX}`)) as Record<string, unknown>;
}

/** The `classcompass://` URI of a document under docs/ (path relative to docs/, `/` separators), or null. */
export function resourceUriOf(rel: string): string | null {
  if (rel === 'THEMING.md') return `${RESOURCE_SCHEME}docs/theming`;
  if (rel === 'theme-package.schema.json') return `${RESOURCE_SCHEME}themes/package-schema`;
  const ex = /^examples\/([a-z0-9-]+)\.theme\.json$/u.exec(rel);
  if (ex && exists(rel)) return `${RESOURCE_SCHEME}themes/examples/${ex[1]}`;
  const guide = /^guides\/([a-z]{2,3})\/([a-z0-9-]+)\.md$/u.exec(rel);
  if (guide && isLocale(guide[1]!) && exists(rel)) return `${RESOURCE_SCHEME}guides/${guide[1]}/${guide[2]}`;
  return null;
}

/**
 * A Markdown document as an MCP client should see it (D-164): relative links point at files an MCP
 * client cannot open, so a link to a document that is a resource becomes its URI (the `#anchor` is
 * kept), and any other relative link (or picture) becomes text naming the repository file.
 * Absolute links (`https:`, `mailto:`, `classcompass:`) and in-page anchors stay as they are.
 */
export function linkDocs(markdown: string, rel: string): string {
  const dir = path.posix.dirname(rel);
  return markdown.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/gu, (whole, bang: string, text: string, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('#')) return whole;
    const [file = '', anchor] = target.split('#', 2);
    const resolved = path.posix.normalize(path.posix.join('docs', dir, file));
    const uri = resolved.startsWith('docs/') ? resourceUriOf(resolved.slice('docs/'.length)) : null;
    if (uri && !bang) return `[${text}](${uri}${anchor ? `#${anchor}` : ''})`;
    return bang ? `(picture "${text}": repository file ${resolved})` : `${text} (repository file ${resolved}, not available here)`;
  });
}
const exists = (rel: string) => fs.existsSync(path.join(DOCS, rel));
/** Static documents from docs/: no school data, so not name-scrubbed (a guide's example name must not be turned into a pseudonym, D-161). */
const Doc = z.string().meta(pii('none'));

/** First `#` heading of a Markdown file, as its title. */
function titleOf(rel: string): string {
  const m = /^#\s+(.+)$/mu.exec(readDoc(rel));
  return m ? m[1]!.trim() : rel;
}

/** The guide languages' names in English for resource descriptions (a later language falls back to its own name). */
const GUIDE_LANGUAGE_NAMES: Partial<Record<string, string>> = { en: 'English', tr: 'Turkish' };

function guideResources(): McpResource[] {
  const out: McpResource[] = [];
  // Every ready interface language (S26c, D-191); the Dockerfile copies each one's guides.
  for (const lang of LOCALES) {
    const dir = path.join(DOCS, 'guides', lang);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const rel = `guides/${lang}/${file}`;
      const id = file.replace(/\.md$/u, '');
      out.push({
        uri: `${RESOURCE_SCHEME}guides/${lang}/${id}`,
        name: `guide-${lang}-${id}`,
        title: titleOf(rel),
        description: `Class Compass user guide (${GUIDE_LANGUAGE_NAMES[lang] ?? LANGUAGES[lang].nativeName}): ${titleOf(rel)}. Read-only Markdown, no school data.`,
        mimeType: 'text/markdown',
        scope: null,
        role: 'any',
        output: Doc,
        read: () => linkDocs(readDoc(rel), rel),
      });
    }
  }
  return out;
}

const MyClasses = z.object({
  classes: z.array(z.object({ contextId: z.string().nullable(), classId: z.string(), className: z.string().meta(pii('label')), subjectName: LocalizedText.nullable(), studentCount: z.number().nullable() })),
});

export function allResources(): McpResource[] {
  const docs: McpResource[] = [];
  if (exists('THEMING.md')) {
    docs.push({
      uri: `${RESOURCE_SCHEME}docs/theming`,
      name: 'theming-guide',
      title: 'Theming guide',
      description: 'docs/THEMING.md: palette design, every colour token, contrast pairs, limits, the SVG allow-list, the theme package format with a worked example and a checklist. Links to other resources are classcompass:// URIs (the schema, the example packages classcompass://themes/examples/<key>). Markdown, no school data.',
      mimeType: 'text/markdown',
      scope: null,
      role: 'any',
      output: Doc,
      read: () => linkDocs(readDoc('THEMING.md'), 'THEMING.md'),
    });
  }
  for (const key of exampleKeys()) {
    const builtin = (THEME_KEYS as readonly string[]).includes(key);
    docs.push({
      uri: `${RESOURCE_SCHEME}themes/examples/${key}`,
      name: `theme-example-${key}`,
      title: builtin ? `Theme package of the built-in theme "${key}"` : `Example theme package "${key}"`,
      description: builtin
        ? `docs/examples/${key}.theme.json: the package Admin → Themes → Export gives for the built-in theme "${key}" (key "${key}-copy", "(copy)" names; its art stays with the base theme). A starting point: change the key, names and colours, then validate_theme. No school data.`
        : `docs/examples/${key}.theme.json: an example of the theming guide, a complete valid package${typeof readExample(key)?.scene === 'object' ? ' with a scene, frames, a background animation and sets (S17a)' : ''}. A starting point: change the key, names and colours, then validate_theme. No school data.`,
      mimeType: 'application/json',
      scope: null,
      role: 'any',
      output: z.record(z.string(), z.unknown()).meta(pii('none')),
      read: () => readExample(key),
    });
  }
  return [
    ...guideResources(),
    ...docs,
    {
      uri: `${RESOURCE_SCHEME}themes/package-schema`,
      name: 'theme-package-schema',
      title: 'Theme package JSON Schema',
      description: 'The JSON Schema of a theme package (the same as the theme_schema tool). No school data.',
      mimeType: 'application/schema+json',
      scope: null,
      role: 'any',
      output: z.record(z.string(), z.unknown()).meta(pii('none')),
      read: () => themePackageJsonSchema(),
    },
    {
      uri: `${RESOURCE_SCHEME}me/classes`,
      name: 'my-classes',
      title: 'My classes',
      description: "The signed-in teacher's class+subjects (context ids, class and subject names). No student data.",
      mimeType: 'application/json',
      scope: 'classes:read',
      role: 'teacher',
      output: MyClasses,
      read: async (env) => ({
        classes: (await callEndpoint(env, S.myContexts, {})).contexts.map((c) => ({ contextId: c.id, classId: c.classId, className: c.className, subjectName: c.subjectName, studentCount: null })),
      }),
    },
    {
      uri: `${RESOURCE_SCHEME}school/classes`,
      name: 'school-classes',
      title: 'Classes of the school',
      description: 'Administrators: the classes of the current school years with their student counts. No student data.',
      mimeType: 'application/json',
      scope: 'school:read',
      role: 'admin',
      output: MyClasses,
      read: async (env) => ({
        classes: (await callEndpoint(env, S.listClasses, {})).classes.map((c) => ({ contextId: null, classId: c.id, className: c.name, subjectName: null, studentCount: c.studentCount })),
      }),
    },
  ];
}
