import { describe, expect, it } from 'vitest';
import { type Card, blockerDone, blockingCounts, compareCards, dueState, dueWindowEnd, matchesFilter, isUnblockDue, moveCard, newCard, nextEffort, setBlocker, shouldArchive, slugify } from '../core/cards.ts';
import { briefing, isIdle } from '../core/today.ts';

const T0 = '2026-10-14T09:00:00-04:00';
const T1 = '2026-10-15T09:00:00-04:00';
const T2 = '2026-10-16T09:00:00-04:00';

const card = (over: Partial<Card> = {}): Card => ({ ...newCard({ id: 'X', title: 'A card', now: T0 }), ...over });

describe('board order', () => {
  it('puts High above Medium above Low', () => {
    const cards = [card({ title: 'low', effort: 'low' }), card({ title: 'high', effort: 'high' }), card({ title: 'med', effort: 'medium' })];
    expect(cards.sort(compareCards).map((c) => c.title)).toEqual(['high', 'med', 'low']);
  });

  it('within an effort level, the card that entered the column first is on top', () => {
    const cards = [
      card({ title: 'newest', enteredColumn: T2 }),
      card({ title: 'oldest', enteredColumn: T0 }),
      card({ title: 'middle', enteredColumn: T1 }),
    ];
    expect(cards.sort(compareCards).map((c) => c.title)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('uses time in the column, not creation time', () => {
    const createdLongAgo = card({ title: 'old card, just moved', created: T0, enteredColumn: T2 });
    const createdRecently = card({ title: 'new card, waiting', created: T1, enteredColumn: T1 });
    expect([createdLongAgo, createdRecently].sort(compareCards)[0]!.title).toBe('new card, waiting');
  });

  it('compares instants correctly across time-zone offsets', () => {
    // 09:00 in New York is 13:00 UTC, so 09:30 UTC happened first despite the bigger clock number.
    const newYork = card({ title: '13:00 UTC', enteredColumn: '2026-10-15T09:00:00-04:00' });
    const utc = card({ title: '09:30 UTC', enteredColumn: '2026-10-15T09:30:00-00:00' });
    expect([newYork, utc].sort(compareCards)[0]!.title).toBe('09:30 UTC');
  });
});

describe('moving cards', () => {
  it('records history and resets time-in-column', () => {
    const moved = moveCard(card(), 'in-progress', T1);
    expect(moved.status).toBe('in-progress');
    expect(moved.enteredColumn).toBe(T1);
    expect(moved.statusHistory).toEqual([
      { status: 'not-started', at: T0 },
      { status: 'in-progress', at: T1 },
    ]);
  });

  it('sets completed on Complete and clears it when moved back', () => {
    const done = moveCard(card(), 'complete', T1);
    expect(done.completed).toBe(T1);
    const reopened = moveCard(done, 'in-progress', T2);
    expect(reopened.completed).toBeNull();
    expect(reopened.statusHistory.map((h) => h.status)).toEqual(['not-started', 'complete', 'in-progress']);
  });

  it('moving to the same column changes nothing', () => {
    const c = card();
    expect(moveCard(c, 'not-started', T1)).toBe(c);
  });

  it('keeps blocker info in history and clears it from the card when leaving Blocked', () => {
    let c = moveCard(card(), 'blocked', T1);
    c = setBlocker(c, 'Legal review', '2026-10-20', T1);
    expect(c.blockedBy).toBe('Legal review');
    expect(c.statusHistory.at(-1)).toEqual({ status: 'blocked', at: T1, blockedBy: 'Legal review', unblockBy: '2026-10-20' });
    c = moveCard(c, 'in-progress', T2);
    expect(c.blockedBy).toBeNull();
    expect(c.unblockBy).toBeNull();
    expect(c.statusHistory[1]).toEqual({ status: 'blocked', at: T1, blockedBy: 'Legal review', unblockBy: '2026-10-20' });
  });

  it('ignores blocker fields on cards that are not Blocked', () => {
    const c = card();
    expect(setBlocker(c, 'x', null, T1)).toBe(c);
  });
});

describe('unblock due', () => {
  const blocked = card({ status: 'blocked', unblockBy: '2026-10-20' });
  it('is due on and after the expected date', () => {
    expect(isUnblockDue(blocked, '2026-10-19')).toBe(false);
    expect(isUnblockDue(blocked, '2026-10-20')).toBe(true);
    expect(isUnblockDue(blocked, '2026-10-25')).toBe(true);
  });
  it('is never due without a date or outside Blocked', () => {
    expect(isUnblockDue(card({ status: 'blocked' }), '2030-01-01')).toBe(false);
    expect(isUnblockDue(card({ unblockBy: '2026-10-20' }), '2030-01-01')).toBe(false);
  });
});

describe('auto-archive timing', () => {
  const done = card({ status: 'complete', completed: '2026-10-10T12:00:00-04:00' });
  it('archives exactly 7 days after completion', () => {
    expect(shouldArchive(done, 7, new Date('2026-10-17T11:59:00-04:00'))).toBe(false);
    expect(shouldArchive(done, 7, new Date('2026-10-17T12:00:00-04:00'))).toBe(true);
  });
  it('only archives Complete cards that are not archived yet', () => {
    const later = new Date('2027-01-01T00:00:00Z');
    expect(shouldArchive(card({ completed: '2026-10-10T12:00:00-04:00' }), 7, later)).toBe(false);
    expect(shouldArchive({ ...done, archived: '2026-10-17T12:00:00-04:00' }, 7, later)).toBe(false);
  });
});

describe('helpers', () => {
  it('cycles effort L → M → H → L', () => {
    expect([nextEffort('low'), nextEffort('medium'), nextEffort('high')]).toEqual(['medium', 'high', 'low']);
  });

  it('makes file-safe slugs', () => {
    expect(slugify('Send intro email for Project Alpha')).toBe('send-intro-email-for-project-alpha');
    expect(slugify('Café / Q3: "plan"?')).toBe('cafe-q3-plan');
    expect(slugify('!!!')).toBe('card');
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('due dates', () => {
  const today = '2026-10-23';
  it('marks overdue, due within a week, or nothing', () => {
    expect(dueState(card({ due: '2026-10-22' }), today)).toBe('overdue');
    expect(dueState(card({ due: today }), today)).toBe('soon');
    expect(dueState(card({ due: '2026-10-30' }), today)).toBe('soon');
    expect(dueState(card({ due: '2026-10-31' }), today)).toBeNull();
    expect(dueState(card(), today)).toBeNull();
  });

  it('never marks a Complete card', () => {
    expect(dueState(card({ due: '2026-10-01', status: 'complete' }), today)).toBeNull();
  });

  it('lists due cards in the briefing, soonest first', () => {
    const now = new Date('2026-10-23T09:00:00');
    const cards = [card({ title: 'later', due: '2026-10-28' }), card({ title: 'late', due: '2026-10-20' }), card({ title: 'far', due: '2026-12-01' })];
    expect(briefing(cards, now).due.map((c) => c.title)).toEqual(['late', 'later']);
  });
});

describe('board filters', () => {
  const today = '2026-10-23'; // Friday
  it('ends the windows on Sunday, the last day of the month, and of the quarter', () => {
    expect(dueWindowEnd('week', today)).toBe('2026-10-25');
    expect(dueWindowEnd('week', '2026-10-26')).toBe('2026-11-01'); // a Monday
    expect(dueWindowEnd('month', today)).toBe('2026-10-31');
    expect(dueWindowEnd('quarter', today)).toBe('2026-12-31');
    expect(dueWindowEnd('quarter', '2026-02-10')).toBe('2026-03-31');
  });

  it('filters by linked note (any case) and by due window, never hiding Complete cards', () => {
    const linked = card({ refs: ['[[Project Alpha]]'], due: '2026-10-24' });
    const other = card({ refs: ['[[Beta]]'], due: '2026-11-20' });
    const done = card({ status: 'complete' });
    const overdue = card({ due: '2026-10-01' });
    expect(matchesFilter(linked, { note: 'project alpha', due: null }, today)).toBe(true);
    expect(matchesFilter(other, { note: 'Project Alpha', due: null }, today)).toBe(false);
    expect(matchesFilter(done, { note: 'Project Alpha', due: 'week' }, today)).toBe(true);
    expect(matchesFilter(linked, { note: null, due: 'week' }, today)).toBe(true);
    expect(matchesFilter(other, { note: null, due: 'week' }, today)).toBe(false);
    expect(matchesFilter(other, { note: null, due: 'month' }, today)).toBe(false);
    expect(matchesFilter(other, { note: null, due: 'quarter' }, today)).toBe(true);
    expect(matchesFilter(overdue, { note: null, due: 'week' }, today)).toBe(true);
    expect(matchesFilter(card(), { note: null, due: 'quarter' }, today)).toBe(false);
  });
});

describe('idle Not Started cards', () => {
  const now = new Date('2026-10-23T09:00:00-04:00');
  it('are Not Started and untouched for 14 days or more', () => {
    expect(isIdle(card({ updated: '2026-10-09T08:00:00-04:00', enteredColumn: '2026-10-01T08:00:00-04:00' }), now)).toBe(true);
    expect(isIdle(card({ updated: '2026-10-10T08:00:00-04:00', enteredColumn: '2026-10-01T08:00:00-04:00' }), now)).toBe(false);
    expect(isIdle(card({ status: 'in-progress', updated: '2026-09-01T08:00:00-04:00', enteredColumn: '2026-09-01T08:00:00-04:00' }), now)).toBe(false);
  });
});

describe('blocked by another card', () => {
  const blocker = card({ id: 'B', title: 'Get legal sign-off', status: 'in-progress' });
  const waiting = setBlocker(moveCard(card({ id: 'W', title: 'Launch' }), 'blocked', T1), null, null, T1, 'B');

  it('knows when the blocking card is done, and which cards are blocking', () => {
    expect(blockerDone(waiting, [blocker, waiting])).toBe(false);
    expect(blockingCounts([blocker, waiting])).toEqual(new Map([['B', 1]]));
    const done = { ...blocker, status: 'complete' as const };
    expect(blockerDone(waiting, [done, waiting])).toBe(true);
    expect(blockingCounts([done, waiting])).toEqual(new Map());
    expect(blockerDone(waiting, [waiting])).toBe(true); // archived or deleted
    expect(blockerDone(card(), [])).toBeNull();
  });

  it('records the blocking card in history, and clears it when the card leaves Blocked', () => {
    expect(waiting.statusHistory.at(-1)).toMatchObject({ status: 'blocked', blockedByCard: 'B' });
    expect(moveCard(waiting, 'in-progress', T2).blockedByCard).toBeNull();
  });

  it('puts a card whose blocker is done on the follow-up list', () => {
    const done = { ...blocker, status: 'complete' as const };
    expect(briefing([done, waiting]).followUp.map((c) => c.id)).toEqual(['W']);
    expect(briefing([blocker, waiting]).followUp).toEqual([]);
  });
});
