/**
 * Super Speakers point reads shared with other modules (S12). The achievements rule engine reads the
 * students' live (not voided) points through `livePointTimes` (D-132), so a voided point never counts
 * towards a badge. Nothing here writes.
 */
import { and, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { pointEvents } from '../../db/schema.ts';
import { isModuleAvailable } from '../school/modules.ts';

/** When each live point of these students was given (school-wide), per student. Empty while the module is off. */
export function livePointTimes(db: Db, studentIds: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!studentIds.length || !isModuleAvailable(db, 'superSpeakers')) return out;
  const rows = db
    .select({ studentId: pointEvents.studentId, at: pointEvents.occurredAt })
    .from(pointEvents)
    .where(and(inArray(pointEvents.studentId, [...studentIds]), isNull(pointEvents.voidedAt)))
    .all();
  for (const r of rows) {
    const list = out.get(r.studentId) ?? [];
    list.push(r.at);
    out.set(r.studentId, list);
  }
  return out;
}
