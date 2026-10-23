// Timestamps are stored as local time with an explicit offset, e.g.
// 2026-10-17T09:30:00-04:00, so week boundaries stay right across daylight saving.

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalIso(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Local calendar date, e.g. 2026-10-17. */
export function toLocalDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Milliseconds since epoch; unparseable or missing values sort last. */
export function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from one YYYY-MM-DD date to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const at = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y!, m! - 1, day!);
  };
  return Math.round((at(to) - at(from)) / DAY_MS);
}
