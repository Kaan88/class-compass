/**
 * Secret Student commands (POST /api/commands) and the End Lesson step (LES-3, SEC-1/4/5). Every
 * command names its lesson and is refused for any other (LES-4). Results before the reveal carry
 * counts only (SEC-3).
 */
import { SecretCommands, SecretEndStepInput } from '../../../shared/contracts/secret.ts';
import { defineCommand } from '../../lib/commands.ts';
import { registerEndLessonStep } from '../lessons/endSteps.ts';
import { draw, endStep, recordOutcome, redraw, reveal } from './service.ts';

defineCommand({ type: 'secret.draw', payload: SecretCommands['secret.draw'], handle: (ctx, p, meta) => draw(ctx, p, meta) });
defineCommand({ type: 'secret.redraw', payload: SecretCommands['secret.redraw'], handle: (ctx, p, meta) => redraw(ctx, p, meta) });
defineCommand({ type: 'secret.reveal', payload: SecretCommands['secret.reveal'], handle: (ctx, p, meta) => reveal(ctx, p, meta) });
defineCommand({ type: 'secret.recordOutcome', payload: SecretCommands['secret.recordOutcome'], handle: (ctx, p, meta) => recordOutcome(ctx, p, meta) });

// Before the core reflection (order 100): reveal + outcomes (SEC-5).
registerEndLessonStep({ key: 'secretStudents', module: 'secretStudents', order: 40, input: SecretEndStepInput, apply: endStep });
