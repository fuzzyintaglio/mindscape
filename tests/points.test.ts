// Points and weekly reviews, checked against a hand-counted test week.
process.env.TZ = 'America/New_York';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Card, type Effort, type HistoryEntry, newCard } from '../core/cards.ts';
import { serializeCard } from '../core/cardFile.ts';
import { DEFAULT_CONFIG } from '../core/configDefaults.ts';
import {
  allEvents,
  cardEvents,
  currentWeek,
  isWeek,
  newlyEarned,
  shiftWeek,
  summarizeWeek,
  weekDays,
  weekOf,
  weekStart,
} from '../core/points.ts';
import { parseReview, pointsHistory, reviewPath, saveReflection, writeDueReviews, writeReview } from '../core/reviews.ts';
import { CardStore } from '../core/store.ts';
import { createApp } from '../server/app.ts';

const rules = DEFAULT_CONFIG;
const tmp = mkdtempSync(join(tmpdir(), 'mindscape-points-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A card with exactly this history (times in New York, i.e. -04:00 in October). */
function card(title: string, effort: Effort, history: [HistoryEntry['status'], string, string?][]): Card {
  const entries: HistoryEntry[] = history.map(([status, at, blockedBy]) => ({ status, at, ...(blockedBy ? { blockedBy } : {}) }));
  const last = entries[entries.length - 1]!;
  return {
    ...newCard({ id: `CARD${String(++n).padStart(22, '0')}`, title, effort, now: entries[0]!.at }),
    status: last.status,
    statusHistory: entries,
    enteredColumn: last.at,
    updated: last.at,
    completed: last.status === 'complete' ? last.at : null,
    blockedBy: last.status === 'blocked' ? (last.blockedBy ?? null) : null,
  };
}

function put(vault: string, folder: string, c: Card) {
  mkdirSync(join(vault, folder), { recursive: true });
  writeFileSync(join(vault, folder, `${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`), serializeCard(c));
}

describe('weeks', () => {
  it('run Monday to Sunday and are named the ISO way', () => {
    expect(weekOf('2026-10-12')).toBe('2026-W42'); // Monday
    expect(weekOf('2026-10-18')).toBe('2026-W42'); // Sunday
    expect(weekOf('2026-10-19')).toBe('2026-W43');
    expect(weekStart('2026-W42')).toBe('2026-10-12');
    expect(weekDays('2026-W42')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  });

  it('handle year ends and daylight saving', () => {
    expect(weekOf('2025-12-29')).toBe('2026-W01'); // the Monday of 2026's first week
    expect(weekStart('2026-W01')).toBe('2025-12-29');
    expect(weekOf('2027-01-01')).toBe('2026-W53'); // 2026 has 53 weeks
    expect(isWeek('2026-W53')).toBe(true);
    expect(isWeek('2025-W53')).toBe(false);
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
    // Clocks go back on Sunday Nov 1, 2026; that Sunday still belongs to its week.
    expect(weekOf('2026-11-01')).toBe('2026-W44');
    expect(weekDays('2026-W45')[0]).toBe('2026-11-02');
    expect(currentWeek(new Date('2026-10-19T00:30:00-04:00'))).toBe('2026-W43');
    expect(currentWeek(new Date('2026-10-18T23:59:00-04:00'))).toBe('2026-W42');
  });
});

describe('points rules', () => {
  it('pays effort points for being Complete, dated by the latest completion', () => {
    const c = card('Twice', 'medium', [
      ['not-started', '2026-10-05T09:00:00-04:00'],
      ['complete', '2026-10-06T09:00:00-04:00'],
      ['in-progress', '2026-10-07T09:00:00-04:00'],
      ['complete', '2026-10-14T09:00:00-04:00'],
    ]);
    expect(cardEvents(c, rules)).toEqual([expect.objectContaining({ kind: 'complete', points: 300, at: '2026-10-14T09:00:00-04:00' })]);
  });

  it('gives the unblock bonus once, only after 24h in Blocked, and only into In Progress or Complete', () => {
    const short = card('Short block', 'low', [
      ['in-progress', '2026-10-12T09:00:00-04:00'],
      ['blocked', '2026-10-12T10:00:00-04:00'],
      ['in-progress', '2026-10-13T09:59:00-04:00'], // 23h59m
    ]);
    expect(cardEvents(short, rules)).toEqual([]);
    const toNotStarted = card('Parked', 'low', [
      ['blocked', '2026-10-12T10:00:00-04:00'],
      ['not-started', '2026-10-14T10:00:00-04:00'],
    ]);
    expect(cardEvents(toNotStarted, rules)).toEqual([]);
    const twice = card('Blocked twice', 'low', [
      ['blocked', '2026-10-12T10:00:00-04:00'],
      ['in-progress', '2026-10-13T10:00:00-04:00'], // exactly 24h: bonus
      ['blocked', '2026-10-13T11:00:00-04:00'],
      ['complete', '2026-10-15T11:00:00-04:00'], // second long block: no second bonus
    ]);
    expect(cardEvents(twice, rules).map((e) => [e.kind, e.points])).toEqual([
      ['unblock', 200],
      ['complete', 100],
    ]);
  });

  it('newlyEarned spots what one move just earned', () => {
    const before = card('Waiting', 'high', [
      ['in-progress', '2026-10-12T09:00:00-04:00'],
      ['blocked', '2026-10-12T10:00:00-04:00'],
    ]);
    const after: Card = { ...before, status: 'complete', completed: '2026-10-14T10:00:00-04:00', statusHistory: [...before.statusHistory, { status: 'complete', at: '2026-10-14T10:00:00-04:00' }] };
    expect(newlyEarned(before, after, rules).map((e) => e.kind).sort()).toEqual(['complete', 'unblock']);
    expect(newlyEarned(after, after, rules)).toEqual([]);
  });
});

describe('a hand-counted test week (2026-W42: Oct 12–18)', () => {
  const vault = join(tmp, 'week');
  mkdirSync(vault, { recursive: true });
  const cards = {
    a: card('Low on Monday', 'low', [
      ['not-started', '2026-10-09T09:00:00-04:00'],
      ['complete', '2026-10-12T09:00:00-04:00'],
    ]),
    b: card('High on Wednesday', 'high', [
      ['in-progress', '2026-10-09T09:00:00-04:00'],
      ['complete', '2026-10-14T15:00:00-04:00'],
    ]),
    c: card('Completed then reopened', 'medium', [
      ['in-progress', '2026-10-09T09:00:00-04:00'],
      ['complete', '2026-10-15T09:00:00-04:00'],
      ['in-progress', '2026-10-16T09:00:00-04:00'],
    ]),
    e: card('Unblocked then done', 'medium', [
      ['in-progress', '2026-10-09T09:00:00-04:00'],
      ['blocked', '2026-10-12T09:00:00-04:00', 'Legal review'],
      ['in-progress', '2026-10-13T10:00:00-04:00'], // 25h: +200
      ['complete', '2026-10-16T17:00:00-04:00'], // +300
    ]),
    f: card('Brief block', 'low', [
      ['in-progress', '2026-10-09T09:00:00-04:00'],
      ['blocked', '2026-10-13T09:00:00-04:00'],
      ['in-progress', '2026-10-13T11:00:00-04:00'], // 2h: nothing
    ]),
    g: card('Done then deleted', 'low', [
      ['not-started', '2026-10-09T09:00:00-04:00'],
      ['complete', '2026-10-13T12:00:00-04:00'], // deleted later: still 100
    ]),
    h: card('Late Sunday last week', 'high', [
      ['in-progress', '2026-10-05T09:00:00-04:00'],
      ['complete', '2026-10-11T23:30:00-04:00'], // W41
    ]),
    i: card('Archived high', 'high', [
      ['in-progress', '2026-09-30T09:00:00-04:00'],
      ['complete', '2026-10-12T08:00:00-04:00'], // in archive/: still 750
    ]),
    j: card('Waiting all week', 'medium', [
      ['in-progress', '2026-10-01T09:00:00-04:00'],
      ['blocked', '2026-10-08T09:00:00-04:00', 'Vendor contract'],
    ]),
    k: card('Gone quiet', 'medium', [
      ['not-started', '2026-09-28T09:00:00-04:00'],
      ['in-progress', '2026-10-05T09:00:00-04:00'],
    ]),
  };
  for (const key of ['a', 'b', 'c', 'e', 'f', 'h', 'j', 'k'] as const) put(vault, 'tasks', cards[key]);
  put(vault, '.trash', cards.g);
  put(vault, 'archive/2026', { ...cards.i, archived: '2026-10-19T08:00:00-04:00' });
  const store = new CardStore(vault);
  const ctx = { vault, files: store.files, store, rules };

  // By hand: A 100 + B 750 + E (200 bonus + 300) + G 100 + I 750 = 2,200; 5 closed. C earns nothing; H is last week.
  it('adds up to the hand count, counting deleted and archived cards', () => {
    const week = summarizeWeek(allEvents(store.pointsCards(), rules), '2026-W42');
    expect(week.points).toBe(2200);
    expect(week.closed).toBe(5);
    expect(week.closedByEffort).toEqual({ low: 2, medium: 1, high: 2 });
    expect(week.bonuses).toBe(1);
    expect(week.bonusPoints).toBe(200);
    expect(week.days).toEqual([850, 300, 750, 0, 300, 0, 0]); // Mon A+I, Tue E bonus + G, Wed B, Fri E
    expect(summarizeWeek(allEvents(store.pointsCards(), rules), '2026-W41').points).toBe(750);
  });

  it('writes the review the Monday after, not before', () => {
    expect(writeDueReviews(ctx, new Date('2026-10-18T23:59:00-04:00'))).toEqual(['2026-W40', '2026-W41']); // from the first week with any activity
    expect(store.files.exists(reviewPath('2026-W42'))).toBe(false);
    expect(writeDueReviews(ctx, new Date('2026-10-19T00:05:00-04:00'))).toEqual(['2026-W42']);
    expect(writeDueReviews(ctx, new Date('2026-10-19T01:05:00-04:00'))).toEqual([]); // once only
  });

  it('the review has the totals, the lists, and a blank Reflection', () => {
    const text = readFileSync(join(vault, 'reviews/2026-W42.md'), 'utf8');
    const review = parseReview(text)!;
    expect(review.meta).toMatchObject({ week: '2026-W42', points: 2200, closed: 5 });
    expect(text).toContain('# Week 42 · October 12–18, 2026');
    expect(text).toContain('**2,200 points** · 5 cards closed');
    expect(text).toContain('| High | 2 | 1,500 |');
    expect(text).toContain('| Unblock bonus | 1 | 200 |');
    expect(text).toContain('Last week: 750 (+1,450)');
    expect(text).toContain(`- [High on Wednesday](#/card/${cards.b.id}) — High · Wed Oct 14`);
    expect(text).toContain(`- [Done then deleted](#/card/${cards.g.id})`); // closed lists come from points, deleted included
    expect(text).toMatch(/## Blocked all week\n- \[Waiting all week\]\(#\/card\/\w+\) — waiting on Vendor contract\n/);
    expect(text).toMatch(/## Gone quiet\n- \[Gone quiet\]\(#\/card\/\w+\) — In Progress, untouched 13 days\n/);
    expect(text).not.toContain('Completed then reopened');
    expect(review.reflection).toBe('');
  });

  it('freezes the total: later changes to old cards don’t rewrite a reviewed week', () => {
    put(vault, 'tasks', { ...cards.b, status: 'in-progress', completed: null, statusHistory: [...cards.b.statusHistory, { status: 'in-progress', at: '2026-10-20T09:00:00-04:00' }] });
    const now = new Date('2026-10-21T09:00:00-04:00');
    expect(summarizeWeek(allEvents(store.pointsCards(), rules), '2026-W42').points).toBe(1450); // live count changed
    const history = pointsHistory(store.pointsCards(), store.files, rules, now);
    expect(history.find((h) => h.week === '2026-W42')).toMatchObject({ points: 2200, frozen: true });
    expect(history.find((h) => h.week === '2026-W43')).toMatchObject({ current: true, frozen: false });
  });

  it('regenerating by hand recounts but keeps the Reflection', () => {
    expect(saveReflection(store.files, '2026-W42', 'Good week. Legal finally moved.')).toMatchObject({ ok: true });
    expect(saveReflection(store.files, '2026-W42', 'Other text', 'stale base')).toMatchObject({ ok: false, reason: 'conflict' });
    expect(writeReview(ctx, '2026-W42', new Date('2026-10-21T09:00:00-04:00'))).toMatchObject({ ok: true });
    const review = parseReview(readFileSync(join(vault, 'reviews/2026-W42.md'), 'utf8'))!;
    expect(review.meta.points).toBe(1450);
    expect(review.reflection).toBe('Good week. Legal finally moved.');
    expect(writeReview(ctx, '2026-W43', new Date('2026-10-21T09:00:00-04:00'))).toMatchObject({ ok: false });
  });

  it('never overwrites a file in reviews/ that it didn’t write', () => {
    writeFileSync(join(vault, 'reviews/2026-W39.md'), '# My own notes\n');
    expect(writeReview(ctx, '2026-W39', new Date('2026-10-21T09:00:00-04:00'))).toMatchObject({ ok: false });
    expect(readFileSync(join(vault, 'reviews/2026-W39.md'), 'utf8')).toBe('# My own notes\n');
  });
});

describe('new reference notes in a review', () => {
  it('come from the vault’s git history', () => {
    const vault = join(tmp, 'git');
    mkdirSync(join(vault, 'reference'), { recursive: true });
    const git = (args: string[], date?: string) =>
      execFileSync('git', ['-C', vault, '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], {
        env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
        stdio: 'ignore',
      });
    git(['init', '-q']);
    writeFileSync(join(vault, 'reference/Older.md'), 'x');
    git(['add', '.']);
    git(['commit', '-qm', 'a'], '2026-10-05T10:00:00-04:00');
    writeFileSync(join(vault, 'reference/Atlas.md'), 'x');
    git(['add', '.']);
    git(['commit', '-qm', 'b'], '2026-10-14T10:00:00-04:00');
    const store = new CardStore(vault);
    put(vault, 'tasks', card('Anything', 'low', [['complete', '2026-10-13T09:00:00-04:00']]));
    writeReview({ vault, files: store.files, store, rules }, '2026-W42', new Date('2026-10-20T09:00:00-04:00'));
    const text = readFileSync(join(vault, 'reviews/2026-W42.md'), 'utf8');
    expect(text).toMatch(/## New reference notes\n- \[\[Atlas\]\]\n\n/);
  });
});

describe('points over the API', () => {
  const vault = join(tmp, 'api');
  process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
  process.env.MINDSCAPE_SETTINGS_DIR = join(tmp, 'settings');
  const { app } = createApp({ vaultPath: vault, port: 4317, dev: false });
  const call = async (method: string, path: string, body?: unknown) =>
    (await app.request(path, { method, headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
  const points = async () => (await call('GET', '/api/board')).points;

  it('complete earns, Undo takes it back, delete keeps it', async () => {
    expect((await points()).points).toBe(0);
    const { card: c } = await call('POST', '/api/cards', { title: 'Finish the deck', status: 'in-progress' });
    const moved = await call('PATCH', `/api/cards/${c.id}`, { status: 'complete' });
    expect(await points()).toMatchObject({ points: 300, closed: 1 });
    await call('POST', `/api/undo/${moved.undoId}`);
    expect(await points()).toMatchObject({ points: 0, closed: 0 });
    await call('PATCH', `/api/cards/${c.id}`, { status: 'complete' });
    await call('DELETE', `/api/cards/${c.id}`);
    expect(await points()).toMatchObject({ points: 300, closed: 1 });
  });

  it('lists the archive and restores a card to In Progress (taking its points back), with Undo', async () => {
    const archived = card('Shipped long ago', 'high', [
      ['in-progress', '2026-09-01T09:00:00-04:00'],
      ['complete', '2026-09-03T09:00:00-04:00'],
    ]);
    put(vault, 'archive/2026', { ...archived, archived: '2026-09-10T09:00:00-04:00' });
    expect((await call('GET', '/api/archive')).cards.map((x: Card) => x.title)).toEqual(['Shipped long ago']);
    const restored = await call('POST', `/api/cards/${archived.id}/restore`);
    expect(restored.card).toMatchObject({ status: 'in-progress', archived: null, completed: null, path: 'tasks/shipped-long-ago.md' });
    expect((await call('GET', '/api/archive')).cards).toEqual([]);
    await call('POST', `/api/undo/${restored.undoId}`);
    expect((await call('GET', '/api/archive')).cards).toHaveLength(1);
  });

  it('serves reviews and the history', async () => {
    const lastWeek = shiftWeek(currentWeek(), -1);
    expect((await call('POST', `/api/reviews/${currentWeek()}`)).error).toMatch(/isn’t over/);
    expect(await call('POST', `/api/reviews/${lastWeek}`)).toMatchObject({ ok: true });
    const { reviews, history } = await call('GET', '/api/reviews');
    expect(reviews.map((r: { week: string }) => r.week)).toContain(lastWeek);
    expect(history.at(-1)).toMatchObject({ week: currentWeek(), current: true });
    const { review } = await call('GET', `/api/reviews/${lastWeek}`);
    expect(review.body).toContain('## Closed');
    expect(await call('PUT', `/api/reviews/${lastWeek}/reflection`, { text: 'Noted.', base: '' })).toMatchObject({ ok: true });
    expect((await call('GET', `/api/reviews/${lastWeek}`)).review.reflection).toBe('Noted.');
  });
});
