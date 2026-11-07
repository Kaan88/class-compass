/**
 * Server-side administration CLI. Run on the server only (never exposed over HTTP).
 *   node src/server/cli.ts migrate
 *   node src/server/cli.ts admin:create --login <login> --name "<Display Name>" [--email x]   (password via stdin)
 *   node src/server/cli.ts admin:reset-password --login <login>                                (password via stdin)
 *   node src/server/cli.ts seed:demo [--force-demo]      fictional demo school (never in production)
 * Initial administrator setup (ACC-3): there is no web registration and no default password.
 */
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config.ts';
import { openDatabase, runMigrations } from './db/client.ts';
import { users } from './db/schema.ts';
import { audit } from './lib/audit.ts';
import { hashPassword } from './lib/crypto.ts';
import { createUser, normaliseLogin, revokeAllUserSessions } from './modules/auth/service.ts';
import { SeedRefused, seedDemo } from './seed/demo.ts';

async function readSecret(prompt: string): Promise<string> {
  if (process.env.CC_PASSWORD) return process.env.CC_PASSWORD;
  process.stderr.write(prompt);
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

const [cmd, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { login: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, 'force-demo': { type: 'boolean' } },
  allowPositionals: true,
});
const config = loadConfig();
const db = openDatabase(config.dbPath);
const system = { type: 'system' as const, id: null };

switch (cmd) {
  case 'migrate':
    runMigrations(db);
    console.log('Migrations applied.');
    break;
  case 'admin:create': {
    runMigrations(db);
    if (!values.login || !values.name) throw new Error('--login and --name are required');
    const password = await readSecret('Password (min 10 chars): ');
    const u = await createUser(db, { login: values.login, displayName: values.name, role: 'admin', password, email: values.email ?? null }, system, Date.now());
    console.log(`Administrator created: ${u.login}`);
    break;
  }
  case 'admin:reset-password': {
    if (!values.login) throw new Error('--login is required');
    const u = db.select().from(users).where(eq(users.login, normaliseLogin(values.login))).get();
    if (!u) throw new Error('No such user');
    const password = await readSecret('New password (min 10 chars): ');
    if (password.length < 10) throw new Error('Password too short');
    const now = Date.now();
    db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: now }).where(eq(users.id, u.id)).run();
    revokeAllUserSessions(db, u.id, now);
    audit(db, system, { action: 'auth.password_reset_cli', entity: 'user', entityId: u.id }, now);
    console.log(`Password reset for ${u.login}; they must change it at next sign-in.`);
    break;
  }
  case 'seed:demo': {
    runMigrations(db);
    try {
      const r = await seedDemo({ db, config, now: Date.now }, { force: values['force-demo'] === true });
      console.log(`Demo school created (fictional data). School year ${r.schoolYear}.`);
      for (const c of r.classes) console.log(`  class ${c.name}: ${c.students} students`);
      console.log('');
      console.log('Demo accounts. These passwords are shown ONCE; store them now:');
      for (const a of r.accounts) console.log(`  ${a.role.padEnd(7)} ${a.login.padEnd(12)} ${a.password}`);
    } catch (err) {
      if (!(err instanceof SeedRefused)) throw err;
      console.error(err.message);
      process.exitCode = 1;
    }
    break;
  }
  default:
    console.error('Commands: migrate | admin:create | admin:reset-password | seed:demo [--force-demo]');
    process.exitCode = 1;
}
db.$client.close();
