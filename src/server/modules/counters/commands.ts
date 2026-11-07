/**
 * Counter commands (POST /api/commands): tap, undo (void) and class bar reset. Handlers run inside
 * the command transaction; the tap's opId is the event id, so retries and replays never count twice
 * (CNT-5, UX-11). Every command names its lesson and is refused for any other (LES-4).
 */
import { CounterCommands } from '../../../shared/contracts/counters.ts';
import { defineCommand } from '../../lib/commands.ts';
import { resetLessonBar, tap, voidEvent } from './service.ts';

defineCommand({ type: 'counter.tap', payload: CounterCommands['counter.tap'], handle: (ctx, p, meta) => tap(ctx, p, meta) });
defineCommand({ type: 'counter.void', payload: CounterCommands['counter.void'], handle: (ctx, p, meta) => voidEvent(ctx, p, meta) });
defineCommand({ type: 'counter.resetLessonBar', payload: CounterCommands['counter.resetLessonBar'], handle: (ctx, p, meta) => resetLessonBar(ctx, p, meta) });
