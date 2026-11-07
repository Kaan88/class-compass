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
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const submitCommands = endpoint({
  method: 'POST',
  path: '/api/commands',
  access: 'classroom',
  input: z.object({ commands: z.array(CommandEnvelope).min(1).max(50) }),
  output: z.object({ results: z.array(CommandResult) }),
});
