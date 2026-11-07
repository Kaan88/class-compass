import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { CommandEnvelope, CommandResult } from '../../shared/contracts/commands.ts';
import { tx } from '../db/client.ts';
import { commandLog } from '../db/schema.ts';
import type { RequestContext } from './context.ts';
import { sha256, stableStringify } from './crypto.ts';
import { AppError } from './errors.ts';

export interface CommandMeta {
  opId: string;
  lessonId?: string | undefined;
  contextId?: string | undefined;
  clientTime?: number | undefined;
}

export interface CommandDef<S extends z.ZodType> {
  type: string;
  payload: S;
  /**
   * Runs synchronously INSIDE the write transaction. Must verify authorisation for the referenced
   * context/lesson itself (never trust meta). Throw AppError to reject.
   */
  handle: (ctx: RequestContext, payload: z.infer<S>, meta: CommandMeta) => unknown;
}

/** A command definition of any payload type, as listed in a module manifest. */
export type AnyCommandDef = CommandDef<z.ZodType>;

/**
 * Declare a command without registering it (SX, D-069). Modules list their commands in their
 * manifest (`commands: [...]`); `installModules()` registers them once with `defineCommand`, so no
 * command depends on an import side effect.
 */
export function command<S extends z.ZodType>(def: CommandDef<S>): AnyCommandDef {
  return def as unknown as AnyCommandDef;
}

const registry = new Map<string, CommandDef<z.ZodType>>();

export function defineCommand<S extends z.ZodType>(def: CommandDef<S>): CommandDef<S> {
  if (registry.has(def.type)) throw new Error(`Duplicate command type ${def.type}`);
  registry.set(def.type, def as unknown as CommandDef<z.ZodType>);
  return def;
}

export const registeredCommandTypes = () => [...registry.keys()];

function actorKey(ctx: RequestContext) {
  return ctx.actor.type === 'system' ? 'system' : `${ctx.actor.type}:${ctx.actor.id}`;
}

/**
 * Idempotent command execution (UX-11, CNT-5):
 * - new opId → run handler + record result atomically
 * - replayed opId with same request → stored result, `replayed: true`, no second effect
 * - replayed opId with different request or actor → CONFLICT
 * - business rejections (AppError) are recorded too, so replays are consistent
 * - unexpected errors are NOT recorded, so the client may retry
 */
export function executeCommand(ctx: RequestContext, env: CommandEnvelope): CommandResult {
  const def = registry.get(env.type);
  if (!def) return { opId: env.opId, ok: false, replayed: false, error: { code: 'VALIDATION', message: `Unknown command ${env.type}`, reason: 'UNKNOWN_COMMAND' } };
  const requestHash = sha256(stableStringify({ type: env.type, payload: env.payload, lessonId: env.lessonId, contextId: env.contextId }));
  const key = actorKey(ctx);

  const replay = (): CommandResult | null => {
    const prev = ctx.db.select().from(commandLog).where(eq(commandLog.opId, env.opId)).get();
    if (!prev) return null;
    if (prev.requestHash !== requestHash || prev.actorKey !== key) {
      return { opId: env.opId, ok: false, replayed: true, error: { code: 'CONFLICT', message: 'Operation id reused with different content', reason: 'OP_ID_REUSED' } };
    }
    return { ...(JSON.parse(prev.resultJson) as CommandResult), replayed: true };
  };

  const record = (result: CommandResult) =>
    ctx.db
      .insert(commandLog)
      .values({ opId: env.opId, actorKey: key, type: env.type, requestHash, resultJson: JSON.stringify(result), createdAt: ctx.now() })
      .run();

  const parsed = def.payload.safeParse(env.payload);
  if (!parsed.success) {
    return { opId: env.opId, ok: false, replayed: false, error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid payload' } };
  }
  const meta: CommandMeta = { opId: env.opId, lessonId: env.lessonId, contextId: env.contextId, clientTime: env.clientTime };
  try {
    return tx(ctx.db, () => {
      const prev = replay();
      if (prev) return prev;
      const result: CommandResult = { opId: env.opId, ok: true, replayed: false, result: def.handle(ctx, parsed.data, meta) ?? null };
      record(result);
      return result;
    });
  } catch (err) {
    if (err instanceof AppError) {
      const reason = (err.details as { reason?: unknown } | undefined)?.reason;
      const result: CommandResult = {
        opId: env.opId,
        ok: false,
        replayed: false,
        error: { code: err.code, message: err.message, ...(typeof reason === 'string' ? { reason } : {}) },
      };
      try {
        tx(ctx.db, () => {
          if (!replay()) record(result);
        });
      } catch {
        /* recording a rejection is best-effort */
      }
      return result;
    }
    throw err;
  }
}
