/**
 * MCP resources (S14h1, D-160): the user guides (English and Turkish), the theming guide, the theme
 * package schema and "my classes". Documents are read from `docs/` next to the server (the Docker
 * image copies them); a missing file is simply not listed. Everything passes the privacy gate like a
 * tool result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LocalizedText, pii } from '../../../shared/contracts/define.ts';
import * as S from '../../../shared/contracts/school.ts';
import type { McpScope } from '../../../shared/mcp.ts';
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
  /** The allow-list schema with `pii()` marks (documents are plain text: `none` then name-scrubbed). */
  output: z.ZodType;
  read: (env: ToolEnv) => Promise<unknown> | unknown;
}

const readDoc = (rel: string) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(DOCS, rel));
const Doc = z.string().meta(pii('teacherText'));

/** First `#` heading of a Markdown file, as its title. */
function titleOf(rel: string): string {
  const m = /^#\s+(.+)$/mu.exec(readDoc(rel));
  return m ? m[1]!.trim() : rel;
}

function guideResources(): McpResource[] {
  const out: McpResource[] = [];
  for (const lang of ['en', 'tr'] as const) {
    const dir = path.join(DOCS, 'guides', lang);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const rel = `guides/${lang}/${file}`;
      const id = file.replace(/\.md$/u, '');
      out.push({
        uri: `${RESOURCE_SCHEME}guides/${lang}/${id}`,
        name: `guide-${lang}-${id}`,
        title: titleOf(rel),
        description: `Class Compass user guide (${lang === 'en' ? 'English' : 'Turkish'}): ${titleOf(rel)}. Read-only Markdown, no school data.`,
        mimeType: 'text/markdown',
        scope: null,
        role: 'any',
        output: Doc,
        read: () => readDoc(rel),
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
      description: 'docs/THEMING.md: palette design, every colour token, contrast pairs, limits, the SVG allow-list, the theme package format with a worked example and a checklist. Markdown, no school data.',
      mimeType: 'text/markdown',
      scope: null,
      role: 'any',
      output: Doc,
      read: () => readDoc('THEMING.md'),
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
