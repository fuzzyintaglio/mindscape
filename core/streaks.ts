// Streaks: weekdays in a row with a Quick Capture, with something written in the daily
// note, and with a card moved forward. Worked out from the vault's files, so there's no
// counter to drift. Weekends never break a streak (but activity on them still counts),
// and today doesn't break one until it's over. Display only; streaks earn no points.
import type { Card } from './cards.ts';
import { dailyPath } from './daily.ts';
import type { VaultFiles } from './files.ts';
import { toLocalDate } from './time.ts';

export interface Streaks {
  capture: number;
  daily: number;
  progress: number;
}

const shift = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return toLocalDate(new Date(y, m - 1, d + days, 12));
};
const weekend = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d, 12).getDay();
  return day === 0 || day === 6;
};

/** Days in a row with activity, counting back from today (or yesterday, if today has none yet). */
export function streakLength(active: Set<string>, today: string = toLocalDate()): number {
  let n = 0;
  let day = today;
  if (!active.has(day)) day = shift(day, -1);
  for (let guard = 0; guard < 3660; guard++, day = shift(day, -1)) {
    if (active.has(day)) n++;
    else if (!weekend(day)) break;
  }
  return n;
}

/** A line a Quick Capture writes: "- 09:41 text" under "## Capture". */
const CAPTURE_LINE = /^[-*+]\s+\d{1,2}:\d{2}\s+\S/;

/** What a daily note shows about its day: was anything captured, and was anything written at all. */
export function noteActivity(text: string): { captured: boolean; written: boolean } {
  let section = '';
  let captured = false;
  let written = false;
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1]!.trim().toLowerCase();
      continue;
    }
    if (!line.trim()) continue;
    written = true;
    if (section === 'capture' && CAPTURE_LINE.test(line)) captured = true;
  }
  return { captured, written };
}

/** Days a card moved forward: Not Started → In Progress, or In Progress → Complete. */
export function progressDays(cards: Card[]): Set<string> {
  const days = new Set<string>();
  for (const card of cards) {
    const h = card.statusHistory;
    for (let i = 1; i < h.length; i++) {
      const from = h[i - 1]!.status;
      const to = h[i]!.status;
      if ((from === 'not-started' && to === 'in-progress') || (from === 'in-progress' && to === 'complete')) days.add(toLocalDate(new Date(h[i]!.at)));
    }
  }
  return days;
}

export function streaks(files: VaultFiles, cards: Card[], today: string = toLocalDate()): Streaks {
  const captured = new Set<string>();
  const written = new Set<string>();
  // Only the recent past can matter: a streak needs every weekday in between.
  for (const rel of files.markdownFiles('daily')) {
    const date = rel.slice('daily/'.length, -'.md'.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;
    const activity = noteActivity(files.read(dailyPath(date)) ?? '');
    if (activity.captured) captured.add(date);
    if (activity.written) written.add(date);
  }
  return { capture: streakLength(captured, today), daily: streakLength(written, today), progress: streakLength(progressDays(cards), today) };
}
