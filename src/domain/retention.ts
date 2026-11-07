/**
 * Local backup retention (DAT-4, D-089): keep the newest backup of each of the last `hourly` hours,
 * `daily` days and `monthly` months (UTC buckets), plus always the newest backup. Everything else may
 * be deleted. Pure; the caller lists and deletes the files.
 */

export interface RetentionPolicy {
  hourly: number;
  daily: number;
  monthly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { hourly: 48, daily: 30, monthly: 12 };

export interface BackupStamp {
  name: string;
  /** Creation time, epoch ms. */
  at: number;
}

const bucketKeys = {
  hourly: (ms: number) => new Date(ms).toISOString().slice(0, 13),
  daily: (ms: number) => new Date(ms).toISOString().slice(0, 10),
  monthly: (ms: number) => new Date(ms).toISOString().slice(0, 7),
} as const;

/** Names of the backups to keep under `policy`. */
export function backupsToKeep(backups: readonly BackupStamp[], policy: RetentionPolicy): Set<string> {
  const newestFirst = [...backups].sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  const keep = new Set<string>();
  if (newestFirst[0]) keep.add(newestFirst[0].name);
  for (const kind of ['hourly', 'daily', 'monthly'] as const) {
    const limit = Math.max(0, policy[kind]);
    const seen = new Set<string>();
    for (const b of newestFirst) {
      const key = bucketKeys[kind](b.at);
      if (seen.has(key)) continue;
      if (seen.size >= limit) break;
      seen.add(key);
      keep.add(b.name);
    }
  }
  return keep;
}
