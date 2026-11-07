/**
 * `npm run new:module -- <key> [--dry-run] [--root <dir>]` (SX, D-069): scaffolds a module.
 *
 * Creates the server manifest (+ an empty command list), the client manifest with a placeholder
 * dashboard slot, i18n keys in en + tr (Turkish marked TODO), a test stub, and adds the module to the
 * shared catalogue (disabled by default) and to both manifest lists. The result typechecks and passes
 * the manifest tests; everything else (contracts, routes, commands, screens, real tests) is the
 * author's work. See docs/EXTENDING.md "Add a module".
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { addMessages, humanize, lit, pascal, runCli, type Workspace } from './scaffold.ts';

const USAGE = 'Usage: npm run new:module -- <camelCaseKey> [--dry-run] [--root <dir>]';

/** A dashboard order no other client piece uses (pieces are sorted by order, test-enforced unique). */
function freeOrder(ws: Workspace): number {
  const dir = join(ws.root, 'src', 'client', 'modules');
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  let max = 0;
  for (const f of walk(dir)) {
    if (!/\.tsx?$/.test(f)) continue;
    const rel = f.slice(ws.root.length + 1).replace(/\\/g, '/');
    for (const m of ws.read(rel).matchAll(/\border:\s*(\d+)/g)) max = Math.max(max, Number(m[1]));
  }
  return (Math.floor(max / 10) + 1) * 10;
}

export function planModule(ws: Workspace, key: string): void {
  const P = pascal(key);
  const title = humanize(key);
  const catalog = 'src/shared/modules.ts';
  if (ws.read(catalog).includes(`key: ${lit(key)}`)) throw new Error(`Module "${key}" is already in ${catalog}`);
  for (const dir of [`src/server/modules/${key}`, `src/client/modules/${key}`]) if (ws.exists(dir)) throw new Error(`${dir} already exists`);

  // 1. Shared catalogue: one line; new modules start disabled until an admin enables them (CFG-1).
  ws.insertBefore(catalog, '] as const satisfies readonly CatalogEntry[];', `  { key: ${lit(key)}, defaultAvailability: 'disabled' },\n`);

  // 2. i18n: the module name and the namespace the client manifest declares.
  addMessages(ws, [
    [`module.${key}`, title],
    [`${key}.title`, title],
    [`${key}.placeholder`, `${title}: coming soon.`],
  ]);

  // 3. Server manifest + command list, registered in the server list.
  ws.create(
    `src/server/modules/${key}/commands.ts`,
    `/**
 * ${title} commands. Classroom writes go through commands (CONVENTIONS): declare each one with
 * \`command({ type: '${key}.…', input, access, apply })\` from lib/commands.ts and list it here; the
 * manifest registers them. Audit inside \`apply\`, use \`ctx.now()\` for time.
 */
import type { AnyCommandDef } from '../../lib/commands.ts';

export const ${key}Commands: readonly AnyCommandDef[] = [];
`,
  );
  ws.create(
    `src/server/modules/${key}/manifest.ts`,
    `/** ${title} (scaffolded by \`npm run new:module\`; see docs/EXTENDING.md "Add a module"). */
import { defineServerModule } from '../manifest.ts';
import { ${key}Commands } from './commands.ts';

export const ${key}Manifest = defineServerModule({
  key: ${lit(key)},
  policyKey: ${lit(key)},
  commands: ${key}Commands,
  // routes: register${P}Routes, // routes.ts: contracts in src/shared/contracts + route(), access classes
  // lessonState: [${key}LessonState], // data polled by the classroom dashboard
  // endSteps: [endLessonStep({ key: '${key}', module: '${key}', order: …, input, apply })],
  // reports: [...], studentPage: [...], // S10/S11 hooks
  // config: { schema: z.object({ … }), defaults: { … } }, // per class+subject settings
});
`,
  );
  const server = 'src/server/modules/index.ts';
  ws.insertBefore(server, '\nexport const SERVER_MODULES', `import { ${key}Manifest } from './${key}/manifest.ts';\n`);
  ws.insertBefore(server, '];', `  ${key}Manifest,\n`, 'export const SERVER_MODULES');

  // 4. Client manifest with a placeholder dashboard slot, registered in the client list.
  ws.create(
    `src/client/modules/${key}/${P}Panel.tsx`,
    `/** ${title} on the classroom dashboard (placeholder from \`npm run new:module\`: replace before release). */
import { useI18n } from '../../lib/i18n.tsx';
import type { DashboardSlot } from '../types.ts';

function ${P}Panel() {
  const { t } = useI18n();
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-${key}-title" data-testid="${key}-panel">
      <h2 id="cc-${key}-title" className="cc-h2">
        {t(${lit(`${key}.title`)})}
      </h2>
      <p className="cc-muted">{t(${lit(`${key}.placeholder`)})}</p>
    </section>
  );
}

export const ${key}DashboardSlot: DashboardSlot = { key: ${lit(key)}, module: ${lit(key)}, order: ${freeOrder(ws)}, Component: ${P}Panel };
`,
  );
  ws.create(
    `src/client/modules/${key}/manifest.tsx`,
    `/** ${title} (scaffolded by \`npm run new:module\`; see docs/EXTENDING.md "Add a module"). */
import { defineClientModule } from '../types.ts';
import { ${key}DashboardSlot } from './${P}Panel.tsx';

export const ${key}ClientManifest = defineClientModule({
  key: ${lit(key)},
  policyKey: ${lit(key)},
  i18nNamespace: ${lit(key)},
  dashboardSlots: [${key}DashboardSlot],
  // startSteps, endSteps (same keys as the server steps), studentCardAddons,
  // teacherPages (menu tile + /teacher/<path>), settingsPanel, invalidations
});
`,
  );
  const client = 'src/client/modules/index.ts';
  ws.insertBefore(client, "import type { ClientModuleManifest } from './types.ts';", `import { ${key}ClientManifest } from './${key}/manifest.tsx';\n`);
  ws.insertBefore(client, '];', `  ${key}ClientManifest,\n`, 'export const CLIENT_MODULES');

  // 5. Test stub.
  ws.create(
    `tests/server/${key}.test.ts`,
    `/** ${title} module (stub from \`npm run new:module\`): add behaviour, permission and audit tests. */
import { describe, expect, it } from 'vitest';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { CONTEXT_MODULES } from '../../src/shared/modules.ts';

describe(${lit(`${key} module`)}, () => {
  it('is registered with its policy key', () => {
    expect(CONTEXT_MODULES).toContain(${lit(key)});
    expect(SERVER_MODULES.find((m) => m.key === ${lit(key)})?.policyKey).toBe(${lit(key)});
  });

  it.todo('commands: validation, access class, audit entry, idempotent replay');
  it.todo('routes: permissions (teacher of the class only) and the module switch');
});
`,
  );
}

if (import.meta.main) {
  runCli(USAGE, planModule, (key) =>
    [
      `Module "${key}" scaffolded (disabled by default). Next, see docs/EXTENDING.md "Add a module":`,
      '  - translate the TODO(tr) strings in src/shared/i18n/tr.ts',
      '  - contracts + routes + commands, then real tests; add a ROADMAP box',
      '  - npm run check',
    ].join('\n'),
  );
}
