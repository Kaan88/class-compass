import { z } from 'zod';
import { endpoint } from './define.ts';

/**
 * Classroom writes go through the command endpoint so they can be queued offline and replayed
 * safely (UX-11, CNT-5). `opId` is a client-generated UUID (v7 preferred). Re-sending the same
 * opId returns the stored result; the same opId with a different payload is a CONFLICT.
 */
export const CommandEnvelope = z.object({
  opId: z.string().uuid(),
  type: z.string().min(1).max(80),
  /** The lesson/context the client believed was active; handlers verify it (LES-4). */
  contextId: z.string().optional(),
  lessonId: z.string().optional(),
  payload: z.unknown(),
  clientTime: z.number().int().optional(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

export const CommandResult = z.object({
  opId: z.string(),
  ok: z.boolean(),
  replayed: z.boolean(),
  result: z.unknown().optional(),
  /**
   * `code` is a stable ErrorCode; `reason` is the machine-readable business reason (details.reason of
   * the AppError, or OP_ID_REUSED / UNKNOWN_COMMAND) that the client translates. `message` is English
   * diagnostics only and is never shown to teachers.
   */
  error: z.object({ code: z.string(), message: z.string(), reason: z.string().optional() }).optional(),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const submitCommands = endpoint({
  method: 'POST',
  path: '/api/commands',
  access: 'classroom',
  /**
   * `asUser`: the account that queued these commands on the device. When it is not the signed-in
   * account the whole request is refused (409 WRONG_ACCOUNT), so commands queued by one teacher are
   * never applied or audited as another teacher on a shared classroom PC (ACC-9, UX-11).
   */
  input: z.object({ commands: z.array(CommandEnvelope).min(1).max(50), asUser: z.string().optional() }),
  output: z.object({ results: z.array(CommandResult) }),
});
