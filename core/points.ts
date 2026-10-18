// Points, worked out from each card's status history — there's no counter that can
// drift. Undo restores the card file, so it takes points back too; deleting or
// archiving moves the file but keeps its history, so points stay. Pure functions,
// so the server, the UI, and the CLI always agree.
import type { Card, Effort } from './cards.ts';
import type { VaultConfig } from './configDefaults.ts';
import { DAY_MS, timeOf, toLocalDate } from './time.ts';

export type PointsRules = Pick<VaultConfig, 'points' | 'unblockBonus' | 'unblockMinHours'>;

export interface PointsEvent {
  cardId: string;
  title: string;
  effort: Effort;
  kind: 'complete' | 'unblock';
  at: string;
  points: number;
}

/**
 * What a card has earned:
 * - its effort points, if it's Complete now, dated by its latest move to Complete;
 * - the unblock bonus, the first time it left Blocked for In Progress or Complete
 *   after at least `unblockMinHours` in Blocked. Once per card.
 */
export function cardEvents(card: Card, rules: PointsRules): PointsEvent[] {
  const events: PointsEvent[] = [];
  const base = { cardId: card.id, title: card.title, effort: card.effort };
  const history = card.statusHistory;
  for (let i = 1; i < history.length; i++) {
    const from = history[i - 1]!;
    const to = history[i]!;
    if (from.status !== 'blocked' || (to.status !== 'in-progress' && to.status !== 'complete')) continue;
    if (timeOf(to.at) - timeOf(from.at) >= rules.unblockMinHours * 60 * 60 * 1000) {
      events.push({ ...base, kind: 'unblock', at: to.at, points: rules.unblockBonus });
      break;
    }
  }
  if (card.status === 'complete') {
    const last = history[history.length - 1];
    const at = last?.status === 'complete' ? last.at : card.completed;
    if (at) events.push({ ...base, kind: 'complete', at, points: rules.points[card.effort] });
  }
  return events;
}

export function allEvents(cards: Card[], rules: PointsRules): PointsEvent[] {
  return cards.flatMap((c) => cardEvents(c, rules)).sort((a, b) => timeOf(a.at) - timeOf(b.at));
}

/** Events in `after` that `before` didn't have — what a single change just earned. */
export function newlyEarned(before: Card, after: Card, rules: PointsRules): PointsEvent[] {
  const had = new Set(cardEvents(before, rules).map((e) => `${e.kind} ${e.at}`));
  return cardEvents(after, rules).filter((e) => !had.has(`${e.kind} ${e.at}`));
}

// ── Weeks ──────────────────────────────────────────────
// Weeks run Monday 00:00 to Sunday 23:59, local time, named the ISO way (2026-W42).

/** Local noon on a YYYY-MM-DD date (noon keeps daylight-saving shifts from changing the day). */
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
};

export function addDays(date: string, days: number): string {
  const d = noon(date);
  return toLocalDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12));
}

const weekday = (d: Date) => (d.getDay() + 6) % 7; // Monday = 0

export function weekOf(date: string): string {
  const d = noon(date);
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - weekday(d), 12);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4, 12);
  const week1 = new Date(year, 0, 4 - weekday(jan4), 12);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekday(d), 12);
  const n = 1 + Math.round((monday.getTime() - week1.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(n).padStart(2, '0')}`;
}

export const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

export function isWeek(key: string): boolean {
  const m = WEEK_KEY.exec(key);
  return !!m && weekOf(weekStart(key)) === key;
}

/** The Monday of a week, as YYYY-MM-DD. */
export function weekStart(key: string): string {
  const m = WEEK_KEY.exec(key);
  if (!m) throw new Error(`Not a week: ${key}`);
  const year = Number(m[1]);
  const jan4 = new Date(year, 0, 4, 12);
  return toLocalDate(new Date(year, 0, 4 - weekday(jan4) + (Number(m[2]) - 1) * 7, 12));
}

export const weekEnd = (key: string) => addDays(weekStart(key), 6);
export const weekDays = (key: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(key), i));
export const shiftWeek = (key: string, weeks: number) => weekOf(addDays(weekStart(key), weeks * 7));
export const currentWeek = (now: Date = new Date()) => weekOf(toLocalDate(now));

/** The local date an event happened on. */
export const eventDate = (e: { at: string }) => toLocalDate(new Date(e.at));

export interface WeekSummary {
  week: string;
  start: string;
  end: string;
  points: number;
  /** Cards closed (completed and still Complete), by effort. */
  closedByEffort: Record<Effort, number>;
  closed: number;
  completionPoints: number;
  bonuses: number;
  bonusPoints: number;
  /** Points per day, Monday first. */
  days: number[];
  events: PointsEvent[];
}

export function summarizeWeek(events: PointsEvent[], week: string): WeekSummary {
  const days = weekDays(week);
  const mine = events.filter((e) => weekOf(eventDate(e)) === week);
  const completes = mine.filter((e) => e.kind === 'complete');
  const bonuses = mine.filter((e) => e.kind === 'unblock');
  const sum = (list: PointsEvent[]) => list.reduce((n, e) => n + e.points, 0);
  return {
    week,
    start: days[0]!,
    end: days[6]!,
    points: sum(mine),
    closedByEffort: {
      low: completes.filter((e) => e.effort === 'low').length,
      medium: completes.filter((e) => e.effort === 'medium').length,
      high: completes.filter((e) => e.effort === 'high').length,
    },
    closed: completes.length,
    completionPoints: sum(completes),
    bonuses: bonuses.length,
    bonusPoints: sum(bonuses),
    days: days.map((day) => sum(mine.filter((e) => eventDate(e) === day))),
    events: mine,
  };
}

/** "2,450" */
export const formatPoints = (n: number) => n.toLocaleString('en-US');

/** What the header strip and the Today panel show. */
export interface WeekStrip {
  week: string;
  points: number;
  closed: number;
  days: number[];
  /** The best total of any earlier week (0 if none). */
  best: number;
}
