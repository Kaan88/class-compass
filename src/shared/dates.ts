/** Date/timezone validators shared by contracts (client + server). Pure, no I/O. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `tz` is an IANA timezone the runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Strict 'YYYY-MM-DD' check including real calendar days (no 2026-02-30). */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
