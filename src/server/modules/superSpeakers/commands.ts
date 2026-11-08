/**
 * Super Speakers commands (S12, D-130). The scorer app queues them in its own outbox and sends them to
 * `/api/scorer/commands`; they are idempotent by opId (the point row's id is the opId) and refuse any
 * caller that is not a scorer link (`SCORER_ONLY`), so the teacher outbox cannot give points.
 */
import { SpeakerCommands } from '../../../shared/contracts/superSpeakers.ts';
import { command, type AnyCommandDef } from '../../lib/commands.ts';
import { awardPoint, voidOwnPoint } from './service.ts';

export const superSpeakersCommands: readonly AnyCommandDef[] = [
  command({ type: 'points.award', payload: SpeakerCommands['points.award'], handle: awardPoint }),
  command({ type: 'points.voidOwn', payload: SpeakerCommands['points.voidOwn'], handle: voidOwnPoint }),
];
