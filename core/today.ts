// The "Today" panel: what needs a nudge, worked out from the cards. Pure, so the
// app and (later) `mindscape briefing` always agree.
import { type Card, compareCards, isUnblockDue } from './cards.ts';
import { DAY_MS, timeOf, toLocalDate } from './time.ts';

/** In Progress with no status change and no edit for this many days = stale. */
export const STALE_DAYS = 7;

export function isStale(card: Card, now: Date = new Date()): boolean {
  if (card.status !== 'in-progress') return false;
  return daysUntouched(card, now) >= STALE_DAYS;
}

/** Whole days since the card was last touched. */
export function daysUntouched(card: Card, now: Date = new Date()): number {
  const last = Math.max(...[card.updated, card.enteredColumn].map(timeOf).filter(Number.isFinite), 0);
  return Math.floor((now.getTime() - last) / DAY_MS);
}

export function briefing<C extends Card>(cards: C[], now: Date = new Date()): { followUp: C[]; stale: C[] } {
  const today = toLocalDate(now);
  return {
    followUp: cards.filter((c) => isUnblockDue(c, today)).sort((a, b) => (a.unblockBy ?? '').localeCompare(b.unblockBy ?? '') || compareCards(a, b)),
    stale: cards.filter((c) => isStale(c, now)).sort((a, b) => daysUntouched(b, now) - daysUntouched(a, now)),
  };
}
