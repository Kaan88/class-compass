/** New school year form (Maintenance → New school year): the prefilled suggestion. */

const shiftYear = (iso: string) => {
  const [y, rest] = [iso.slice(0, 4), iso.slice(4)];
  const next = `${Number(y) + 1}${rest}`;
  // 29 February does not exist in every year.
  return next.endsWith('-02-29') ? next.replace(/-02-29$/u, '-02-28') : next;
};

/** The suggested new year: the old one's name and dates moved on by one year (an empty form without one). */
export function suggestNextYear(from: { name: string; startsOn: string; endsOn: string } | undefined) {
  if (!from) return { name: '', startsOn: '', endsOn: '' };
  return { name: from.name.replace(/\d{4}/gu, (y) => String(Number(y) + 1)), startsOn: shiftYear(from.startsOn), endsOn: shiftYear(from.endsOn) };
}
