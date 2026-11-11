/**
 * AI connections (S19a, D-179): the school's connections (administrators) and teachers' own ones
 * (only while the administrator allows them, only visible to and usable by their owner).
 *
 * - Secrets are sealed on write (`sealConnectionSecret`), opened only by `provider.ts` just before a
 *   request, and never returned, logged, audited or exported; a response says only `hasSecret`.
 * - Every change is audited without the secret (`keyReplaced`, `keyRemoved` at most).
 * - Usage is counts and tokens per connection, account and local day (school timezone).
 * - Limits: a monthly token budget per connection and a daily message limit per account, checked by
 *   `beginAssistantMessage` (the assistant's agent loop, S19b, calls it before each message).
 */
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AI_PERSONAL_CONNECTIONS_MAX,
  AI_SCHOOL_CONNECTIONS_MAX,
  KEY_TYPES,
  PERSONAL_CONNECTION_TYPES,
  SECRET_REQUIRED,
  type AiConnectionType,
} from '../../../shared/aiConnections.ts';
import type * as C from '../../../shared/contracts/aiConnections.ts';
import { localDate } from '../../../domain/dates.ts';
import { chatgptAvailable } from '../../config.ts';
import { tx, type Db } from '../../db/client.ts';
import { aiConnectionSettings, aiConnections, aiConnectionUsage, aiOauthStates, type AiModelJson } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type AppDeps, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { sealConnectionSecret, type ConnectionRow } from './provider.ts';
import { checkBaseUrl } from './urlSafety.ts';

type In<E extends { input: z.ZodType }> = z.infer<E['input']>;
type View = z.infer<typeof C.AiConnectionView>;
export type Scope = 'school' | 'personal';

// ---------------------------------------------------------------- settings
export function connectionSettings(db: Db): z.infer<typeof C.AiConnectionSettings> {
  const s = db.select().from(aiConnectionSettings).where(eq(aiConnectionSettings.id, 1)).get();
  return { defaultConnectionId: s?.defaultConnectionId ?? null, defaultModel: s?.defaultModel ?? null, teacherConnectionsAllowed: s?.teacherConnectionsAllowed ?? false };
}

function writeSettings(db: Db, patch: Partial<typeof aiConnectionSettings.$inferInsert>, now: number) {
  db.insert(aiConnectionSettings)
    .values({ id: 1, defaultConnectionId: null, defaultModel: null, teacherConnectionsAllowed: false, ...patch, updatedAt: now })
    .onConflictDoUpdate({ target: aiConnectionSettings.id, set: { ...patch, updatedAt: now } })
    .run();
}

// ---------------------------------------------------------------- usage
const schoolTz = (db: Db) => getSchoolSettings(db).timezone;
const today = (deps: Pick<AppDeps, 'db' | 'now'>) => localDate(deps.now(), schoolTz(deps.db));

export function usageOf(deps: Pick<AppDeps, 'db' | 'now'>, connectionId: string, userId: string | null): z.infer<typeof C.AiUsage> {
  const day = today(deps);
  const month = day.slice(0, 7);
  const forUser = userId ? [eq(aiConnectionUsage.userId, userId)] : [];
  const m = deps.db
    .select({ messages: sql<number>`coalesce(sum(${aiConnectionUsage.messages}), 0)`, input: sql<number>`coalesce(sum(${aiConnectionUsage.inputTokens}), 0)`, output: sql<number>`coalesce(sum(${aiConnectionUsage.outputTokens}), 0)` })
    .from(aiConnectionUsage)
    .where(and(eq(aiConnectionUsage.connectionId, connectionId), like(aiConnectionUsage.localDate, `${month}-%`), ...forUser))
    .get();
  const d = deps.db
    .select({ messages: sql<number>`coalesce(sum(${aiConnectionUsage.messages}), 0)` })
    .from(aiConnectionUsage)
    .where(and(eq(aiConnectionUsage.connectionId, connectionId), eq(aiConnectionUsage.localDate, day), ...forUser))
    .get();
  return { monthMessages: m?.messages ?? 0, monthInputTokens: m?.input ?? 0, monthOutputTokens: m?.output ?? 0, todayMessages: d?.messages ?? 0 };
}

/** Tokens used this month by everyone on the connection (what the budget counts). */
const monthTokens = (deps: Pick<AppDeps, 'db' | 'now'>, connectionId: string) => {
  const u = usageOf(deps, connectionId, null);
  return u.monthInputTokens + u.monthOutputTokens;
};

function bump(deps: Pick<AppDeps, 'db' | 'now'>, connectionId: string, userId: string, add: { messages?: number; inputTokens?: number; outputTokens?: number }) {
  const day = today(deps);
  const m = add.messages ?? 0;
  const i = Math.max(0, Math.round(add.inputTokens ?? 0));
  const o = Math.max(0, Math.round(add.outputTokens ?? 0));
  deps.db
    .insert(aiConnectionUsage)
    .values({ connectionId, userId, localDate: day, messages: m, inputTokens: i, outputTokens: o })
    .onConflictDoUpdate({
      target: [aiConnectionUsage.connectionId, aiConnectionUsage.userId, aiConnectionUsage.localDate],
      set: { messages: sql`${aiConnectionUsage.messages} + ${m}`, inputTokens: sql`${aiConnectionUsage.inputTokens} + ${i}`, outputTokens: sql`${aiConnectionUsage.outputTokens} + ${o}` },
    })
    .run();
}

/** Adds a reply's tokens (the `usage` event of `streamChat`, or a connection test). */
export const recordTokens = (deps: Pick<AppDeps, 'db' | 'now'>, connectionId: string, userId: string, usage: { inputTokens: number; outputTokens: number }) => bump(deps, connectionId, userId, usage);

// ---------------------------------------------------------------- views
export const isSecretRequired = (type: AiConnectionType) => SECRET_REQUIRED.includes(type);

export function statusOf(deps: Pick<AppDeps, 'db' | 'now' | 'config'>, row: ConnectionRow): View['status'] {
  if (!row.enabled) return 'paused';
  if (row.type === 'chatgpt' && !chatgptAvailable(deps.config)) return 'notAvailable';
  if (isSecretRequired(row.type) && !row.secretCipher) return 'needsKey';
  if (row.monthlyTokenBudget !== null && monthTokens(deps, row.id) >= row.monthlyTokenBudget) return 'overBudget';
  return 'ready';
}

export function viewOf(deps: Pick<AppDeps, 'db' | 'now' | 'config'>, row: ConnectionRow): View {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    scope: row.ownerUserId ? 'personal' : 'school',
    baseUrl: row.type === 'openaiCompatible' ? row.baseUrl : null,
    localNetwork: row.localNetwork,
    models: row.modelsJson.map((m) => ({ name: m.name, testedAt: m.testedAt, text: m.text, tools: m.tools })),
    hasSecret: row.secretCipher !== null,
    secretSetAt: row.secretSetAt,
    secretSource: row.secretSource,
    monthlyTokenBudget: row.monthlyTokenBudget,
    dailyMessageLimit: row.dailyMessageLimit,
    enabled: row.enabled,
    status: statusOf(deps, row),
    // A teacher's own connection shows that teacher's usage; a school one everyone's.
    usage: usageOf(deps, row.id, row.ownerUserId),
    kvkkConfirmedAt: row.kvkkConfirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const liveRows = (db: Db, ownerUserId: string | null) =>
  db
    .select()
    .from(aiConnections)
    .where(and(ownerUserId ? eq(aiConnections.ownerUserId, ownerUserId) : isNull(aiConnections.ownerUserId), isNull(aiConnections.deletedAt)))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);

export function adminView(ctx: RequestContext): z.infer<typeof C.AiConnectionsAdmin> {
  const personal = ctx.db.select({ n: sql<number>`count(*)` }).from(aiConnections).where(and(sql`${aiConnections.ownerUserId} is not null`, isNull(aiConnections.deletedAt))).get()?.n ?? 0;
  return { connections: liveRows(ctx.db, null).map((r) => viewOf(ctx, r)), settings: connectionSettings(ctx.db), chatgptAvailable: chatgptAvailable(ctx.config), personalConnections: personal };
}

export function ownView(ctx: RequestContext): z.infer<typeof C.OwnAiConnections> {
  const user = requireUser(ctx);
  const s = connectionSettings(ctx.db);
  const def = s.defaultConnectionId ? ctx.db.select().from(aiConnections).where(and(eq(aiConnections.id, s.defaultConnectionId), isNull(aiConnections.deletedAt))).get() : undefined;
  return {
    allowed: s.teacherConnectionsAllowed,
    connections: liveRows(ctx.db, user.id).map((r) => viewOf(ctx, r)),
    schoolDefault: def && s.defaultModel ? { name: def.name, type: def.type, model: s.defaultModel } : null,
    chatgptAvailable: chatgptAvailable(ctx.config),
  };
}

// ---------------------------------------------------------------- loading with ownership
/**
 * The connection the caller may manage: a school connection for administrators, the caller's own for
 * teachers. Anything else (deleted, another teacher's, a school one for a teacher) answers 404.
 */
export function loadManaged(ctx: RequestContext, id: string, scope: Scope): ConnectionRow {
  const user = requireUser(ctx);
  const row = ctx.db.select().from(aiConnections).where(eq(aiConnections.id, id)).get();
  if (!row || row.deletedAt !== null) throw notFound('Connection');
  if (scope === 'school' ? row.ownerUserId !== null : row.ownerUserId !== user.id) throw notFound('Connection');
  return row;
}

function assertTeachersAllowed(db: Db) {
  if (!connectionSettings(db).teacherConnectionsAllowed) throw new AppError('FEATURE_DISABLED', 'Own connections are not allowed at this school', { reason: 'AI_OWN_CONNECTIONS_OFF' });
}

const uniqueModels = (names: string[]) => [...new Set(names.map((n) => n.trim()))];

function urlFor(type: AiConnectionType, baseUrl: string | undefined, localNetwork: boolean): string | null {
  if (type !== 'openaiCompatible') {
    if (baseUrl !== undefined) throw invalid('Only an OpenAI-compatible connection takes an address', { reason: 'AI_URL_NOT_FOR_TYPE' });
    return null;
  }
  if (!baseUrl) throw invalid('An address is required', { reason: 'AI_URL_REQUIRED' });
  const checked = checkBaseUrl(baseUrl, localNetwork);
  if (!checked.ok) throw invalid('This address is not allowed', { reason: `AI_URL_${checked.reason}` });
  return checked.url;
}

function assertKeyAllowed(type: AiConnectionType, hasKey: boolean) {
  if (hasKey && !KEY_TYPES.includes(type)) throw invalid('This connection signs in with the provider instead of a key', { reason: 'AI_KEY_NOT_FOR_TYPE' });
}

function assertTypeAvailable(ctx: RequestContext, type: AiConnectionType) {
  if (type === 'chatgpt' && !chatgptAvailable(ctx.config)) throw new AppError('FEATURE_DISABLED', 'Sign in with ChatGPT is not available', { reason: 'AI_CHATGPT_NOT_AVAILABLE' });
}

// ---------------------------------------------------------------- create, update, delete
export function createConnection(ctx: RequestContext, input: In<typeof C.createAiConnection>, scope: Scope): View {
  const user = requireUser(ctx);
  if (scope === 'personal') {
    assertTeachersAllowed(ctx.db);
    if (!(PERSONAL_CONNECTION_TYPES as readonly string[]).includes(input.type)) throw invalid('Not available as a personal connection', { reason: 'AI_TYPE_NOT_ALLOWED' });
  }
  assertTypeAvailable(ctx, input.type);
  assertKeyAllowed(input.type, input.apiKey !== undefined);
  const baseUrl = urlFor(input.type, input.baseUrl, input.localNetwork);
  const now = ctx.now();
  const id = newId();
  const owner = scope === 'personal' ? user.id : null;
  return tx(ctx.db, () => {
    const n = liveRows(ctx.db, owner).length;
    const max = scope === 'personal' ? AI_PERSONAL_CONNECTIONS_MAX : AI_SCHOOL_CONNECTIONS_MAX;
    if (n >= max) throw conflict('Too many connections', { reason: 'AI_TOO_MANY_CONNECTIONS', max });
    const row: ConnectionRow = {
      id,
      ownerUserId: owner,
      type: input.type,
      name: input.name,
      baseUrl,
      localNetwork: input.type === 'openaiCompatible' ? input.localNetwork : false,
      modelsJson: uniqueModels(input.models).map((name): AiModelJson => ({ name, testedAt: null, text: null, tools: null })),
      secretCipher: input.apiKey ? sealConnectionSecret(ctx, id, input.apiKey) : null,
      secretSetAt: input.apiKey ? now : null,
      secretSource: input.apiKey ? 'pasted' : null,
      monthlyTokenBudget: input.monthlyTokenBudget,
      dailyMessageLimit: input.dailyMessageLimit,
      enabled: true,
      kvkkConfirmedAt: now,
      kvkkConfirmedBy: user.id,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    ctx.db.insert(aiConnections).values(row).run();
    audit(
      ctx.db,
      ctx.actor,
      {
        action: 'ai_connection.create',
        entity: 'ai_connection',
        entityId: id,
        after: { scope, type: row.type, name: row.name, models: row.modelsJson.map((m) => m.name), hasKey: row.secretCipher !== null, baseUrl: row.baseUrl, localNetwork: row.localNetwork, monthlyTokenBudget: row.monthlyTokenBudget, dailyMessageLimit: row.dailyMessageLimit, kvkkConfirmed: true },
      },
      now,
    );
    return viewOf(ctx, row);
  });
}

export function updateConnection(ctx: RequestContext, input: In<typeof C.updateAiConnection>, scope: Scope): View {
  const row = loadManaged(ctx, input.connectionId, scope);
  if (scope === 'personal') assertTeachersAllowed(ctx.db);
  assertKeyAllowed(row.type, input.apiKey !== undefined);
  if (input.apiKey !== undefined && input.removeSecret) throw invalid('Replace or remove the key, not both', { reason: 'AI_KEY_CONFLICT' });
  const now = ctx.now();
  const patch: Partial<ConnectionRow> = {};
  const changed: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== row.name) changed.name = patch.name = input.name;
  if (input.models !== undefined) {
    const old = new Map(row.modelsJson.map((m) => [m.name, m]));
    patch.modelsJson = uniqueModels(input.models).map((name) => old.get(name) ?? { name, testedAt: null, text: null, tools: null });
    changed.models = patch.modelsJson.map((m) => m.name);
  }
  if (input.baseUrl !== undefined || input.localNetwork !== undefined) {
    if (row.type !== 'openaiCompatible') throw invalid('Only an OpenAI-compatible connection takes an address', { reason: 'AI_URL_NOT_FOR_TYPE' });
    const local = input.localNetwork ?? row.localNetwork;
    patch.baseUrl = urlFor(row.type, input.baseUrl ?? row.baseUrl ?? '', local);
    patch.localNetwork = local;
    changed.baseUrl = patch.baseUrl;
    changed.localNetwork = local;
  }
  if (input.apiKey !== undefined) {
    patch.secretCipher = sealConnectionSecret(ctx, row.id, input.apiKey);
    patch.secretSetAt = now;
    patch.secretSource = 'pasted';
    changed.keyReplaced = true;
  } else if (input.removeSecret && row.secretCipher !== null) {
    patch.secretCipher = null;
    patch.secretSetAt = null;
    patch.secretSource = null;
    changed.keyRemoved = true;
  }
  if (input.monthlyTokenBudget !== undefined) changed.monthlyTokenBudget = patch.monthlyTokenBudget = input.monthlyTokenBudget;
  if (input.dailyMessageLimit !== undefined) changed.dailyMessageLimit = patch.dailyMessageLimit = input.dailyMessageLimit;
  if (input.enabled !== undefined && input.enabled !== row.enabled) changed.enabled = patch.enabled = input.enabled;
  if (!Object.keys(patch).length) return viewOf(ctx, row);
  return tx(ctx.db, () => {
    ctx.db.update(aiConnections).set({ ...patch, updatedAt: now }).where(eq(aiConnections.id, row.id)).run();
    // The school default must stay one of the connection's models.
    const s = connectionSettings(ctx.db);
    if (patch.modelsJson && s.defaultConnectionId === row.id && s.defaultModel && !patch.modelsJson.some((m) => m.name === s.defaultModel)) {
      writeSettings(ctx.db, { defaultModel: null }, now);
      changed.defaultModelCleared = true;
    }
    audit(ctx.db, ctx.actor, { action: 'ai_connection.update', entity: 'ai_connection', entityId: row.id, after: changed }, now);
    return viewOf(ctx, { ...row, ...patch, updatedAt: now });
  });
}

/** Deletes a connection: the secret is erased at once; the row stays (usage history), out of every list. */
export function deleteConnection(ctx: RequestContext, id: string, scope: Scope) {
  const row = loadManaged(ctx, id, scope);
  const now = ctx.now();
  tx(ctx.db, () => {
    ctx.db.update(aiConnections).set({ deletedAt: now, secretCipher: null, secretSetAt: null, secretSource: null, enabled: false, updatedAt: now }).where(eq(aiConnections.id, row.id)).run();
    ctx.db.update(aiOauthStates).set({ usedAt: now }).where(and(eq(aiOauthStates.connectionId, row.id), isNull(aiOauthStates.usedAt))).run();
    const s = connectionSettings(ctx.db);
    const wasDefault = s.defaultConnectionId === row.id;
    if (wasDefault) writeSettings(ctx.db, { defaultConnectionId: null, defaultModel: null }, now);
    audit(ctx.db, ctx.actor, { action: 'ai_connection.delete', entity: 'ai_connection', entityId: row.id, before: { scope, type: row.type, name: row.name }, after: wasDefault ? { defaultCleared: true } : null }, now);
  });
  return { ok: true as const };
}

export function setSettings(ctx: RequestContext, input: In<typeof C.setAiConnectionSettings>): z.infer<typeof C.AiConnectionSettings> {
  const before = connectionSettings(ctx.db);
  const next = { ...before };
  if (input.teacherConnectionsAllowed !== undefined) next.teacherConnectionsAllowed = input.teacherConnectionsAllowed;
  if (input.defaultConnectionId !== undefined) {
    next.defaultConnectionId = input.defaultConnectionId;
    if (input.defaultModel === undefined) next.defaultModel = null;
  }
  if (input.defaultModel !== undefined) next.defaultModel = input.defaultModel;
  if (next.defaultConnectionId === null) next.defaultModel = null;
  if (next.defaultConnectionId !== null) {
    const row = loadManaged(ctx, next.defaultConnectionId, 'school');
    if (next.defaultModel === null) next.defaultModel = row.modelsJson[0]?.name ?? null;
    if (!row.modelsJson.some((m) => m.name === next.defaultModel)) throw invalid('Not one of the connection’s models', { reason: 'AI_MODEL_NOT_ALLOWED' });
  }
  if (JSON.stringify(next) === JSON.stringify(before)) return before;
  const now = ctx.now();
  tx(ctx.db, () => {
    writeSettings(ctx.db, next, now);
    audit(ctx.db, ctx.actor, { action: 'ai_connection.settings', entity: 'ai_connection_settings', entityId: '1', before, after: next }, now);
  });
  return next;
}

// ---------------------------------------------------------------- use by the assistant (S19b)
/**
 * The connection and model a chat message goes to: the one asked for (a school connection, or the
 * caller's own while the administrator allows own connections), else the school default. Refuses a
 * connection that is not ready and a model that is not allowed.
 */
export function connectionForUse(ctx: RequestContext, connectionId: string | null, model: string | null): { row: ConnectionRow; model: string } {
  const user = requireUser(ctx);
  const s = connectionSettings(ctx.db);
  const id = connectionId ?? s.defaultConnectionId;
  if (!id) throw new AppError('FEATURE_DISABLED', 'No connection is set up', { reason: 'AI_NO_CONNECTION' });
  const row = ctx.db.select().from(aiConnections).where(eq(aiConnections.id, id)).get();
  if (!row || row.deletedAt !== null || (row.ownerUserId !== null && row.ownerUserId !== user.id)) throw notFound('Connection');
  if (row.ownerUserId !== null) assertTeachersAllowed(ctx.db);
  const status = statusOf(ctx, row);
  if (status === 'overBudget') throw new AppError('RATE_LIMITED', 'The connection’s monthly budget is used up', { reason: 'AI_OVER_BUDGET' });
  if (status !== 'ready') throw new AppError('FEATURE_DISABLED', 'The connection is not ready', { reason: 'AI_CONNECTION_NOT_READY', status });
  const chosen = model ?? (connectionId === null || connectionId === s.defaultConnectionId ? s.defaultModel : null) ?? row.modelsJson[0]?.name ?? null;
  if (!chosen || !row.modelsJson.some((m) => m.name === chosen)) throw invalid('Not one of the connection’s models', { reason: 'AI_MODEL_NOT_ALLOWED' });
  return { row, model: chosen };
}

/**
 * Before each assistant message (S19b): resolves the connection, checks the monthly token budget and
 * the caller's daily message limit, and counts the message, in one transaction.
 */
export function beginAssistantMessage(ctx: RequestContext, connectionId: string | null, model: string | null): { row: ConnectionRow; model: string } {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const used = connectionForUse(ctx, connectionId, model);
    if (used.row.dailyMessageLimit !== null && usageOf(ctx, used.row.id, user.id).todayMessages >= used.row.dailyMessageLimit)
      throw new AppError('RATE_LIMITED', 'Daily message limit reached', { reason: 'AI_DAILY_LIMIT', limit: used.row.dailyMessageLimit });
    bump(ctx, used.row.id, user.id, { messages: 1 });
    return used;
  });
}

/** Stores what a test found for one model. */
export function recordTest(db: Db, row: ConnectionRow, model: string, result: { text: boolean; tools: boolean }, now: number) {
  const fresh = db.select().from(aiConnections).where(eq(aiConnections.id, row.id)).get();
  if (!fresh) return;
  const models = fresh.modelsJson.map((m) => (m.name === model ? { ...m, testedAt: now, text: result.text, tools: result.tools } : m));
  db.update(aiConnections).set({ modelsJson: models }).where(eq(aiConnections.id, row.id)).run();
}
