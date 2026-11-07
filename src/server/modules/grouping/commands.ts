/** Grouping commands (POST /api/commands): use an arrangement in the lesson, or take it off the display (GRP-5, UX-8). */
import { GroupingCommands } from '../../../shared/contracts/grouping.ts';
import { command } from '../../lib/commands.ts';
import { applyGrouping, clearGrouping, moveInGrouping, restoreGrouping, saveGroupingToOption, shuffleGrouping } from './service.ts';

/** Listed in the manifest; registered once by installModules() (D-069). */
export const groupingCommands = [
  command({ type: 'grouping.apply', payload: GroupingCommands['grouping.apply'], handle: (ctx, p, meta) => applyGrouping(ctx, p, meta) }),
  command({ type: 'grouping.clear', payload: GroupingCommands['grouping.clear'], handle: (ctx, p, meta) => clearGrouping(ctx, p, meta) }),
  command({ type: 'grouping.shuffle', payload: GroupingCommands['grouping.shuffle'], handle: (ctx, p, meta) => shuffleGrouping(ctx, p, meta) }),
  command({ type: 'grouping.restore', payload: GroupingCommands['grouping.restore'], handle: (ctx, p, meta) => restoreGrouping(ctx, p, meta) }),
  command({ type: 'grouping.move', payload: GroupingCommands['grouping.move'], handle: (ctx, p, meta) => moveInGrouping(ctx, p, meta) }),
  command({ type: 'grouping.saveToOption', payload: GroupingCommands['grouping.saveToOption'], handle: (ctx, p, meta) => saveGroupingToOption(ctx, p, meta) }),
];
