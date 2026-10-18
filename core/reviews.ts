// Weekly reviews: reviews/2026-W42.md, written the first time the app runs after a
// week ends (or by hand). The week's total goes into the file's frontmatter and is
// frozen there: later changes to old cards don't rewrite history. Regenerating by
// hand recomputes everything except the Reflection you wrote.
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { type Card, EFFORTS, type Effort, type Status } from './cards.ts';
import { formatDay } from './daily.ts';
import type { VaultFiles } from './files.ts';
import {
  type PointsRules,
  type WeekSummary,
  addDays,
  allEvents,
  currentWeek,
  formatPoints,
  isWeek,
  shiftWeek,
  summarizeWeek,
  weekOf,
  weekStart,
} from './points.ts';
import type { CardStore } from './store.ts';
import { DAY_MS, timeOf, toLocalDate, toLocalIso } from './time.ts';
import { STALE_DAYS } from './today.ts';

export const REVIEWS = 'reviews';
export const reviewPath = (week: string) => `${REVIEWS}/${week}.md`;

/** How far back the app fills in missing reviews on its own. */
const BACKFILL_WEEKS = 12;

const EFFORT_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const REFLECTION = /^## Reflection[ \t]*$/m;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ReviewSummary {
  week: string;
  start: string;
  end: string;
  points: number;
  closed: number;
  path: string;
}

export interface WeekPoints {
  week: string;
  start: string;
  points: number;
  closed: number;
  /** True when the total comes from a written review (frozen), false when it's worked out live. */
  frozen: boolean;
  current: boolean;
}

/** A review's frontmatter, or null if the file isn't a Mindscape review. */
export function parseReview(text: string): { meta: ReviewSummary; body: string; reflection: string } | null {
  const m = FRONTMATTER.exec(text);
  if (!m) return null;
  let raw: Record<string, unknown>;
  try {
    raw = (YAML.parse(m[1]!) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  const week = String(raw.week ?? '');
  if (!isWeek(week) || typeof raw.points !== 'number') return null;
  const body = text.slice(m[0].length);
  const at = REFLECTION.exec(body);
  return {
    meta: {
      week,
      start: weekStart(week),
      end: addDays(weekStart(week), 6),
      points: raw.points,
      closed: typeof raw.closed === 'number' ? raw.closed : 0,
      path: reviewPath(week),
    },
    body: at ? body.slice(0, at.index).trimEnd() + '\n' : body,
    reflection: at ? body.slice(at.index + at[0].length).replace(/^\n+/, '').trimEnd() : '',
  };
}

export function listReviews(files: VaultFiles): ReviewSummary[] {
  const out: ReviewSummary[] = [];
  for (const rel of files.markdownFiles(REVIEWS, true)) {
    const parsed = parseReview(files.read(rel) ?? '');
    if (parsed && rel === parsed.meta.path) out.push(parsed.meta);
  }
  return out.sort((a, b) => b.week.localeCompare(a.week));
}

/**
 * Points per week, oldest first, from the first week with any points up to this
 * week. Weeks with a review use its frozen total; the rest are worked out live.
 */
export function pointsHistory(cards: Card[], files: VaultFiles, rules: PointsRules, now: Date = new Date()): WeekPoints[] {
  const events = allEvents(cards, rules);
  const frozen = new Map(listReviews(files).map((r) => [r.week, r]));
  const thisWeek = currentWeek(now);
  const starts = [thisWeek, ...frozen.keys(), ...events.map((e) => weekOf(toLocalDate(new Date(e.at))))].filter((w) => w <= thisWeek);
  let week = starts.reduce((a, b) => (a < b ? a : b));
  const out: WeekPoints[] = [];
  for (; week <= thisWeek; week = shiftWeek(week, 1)) {
    const review = week === thisWeek ? undefined : frozen.get(week);
    const live = review ? null : summarizeWeek(events, week);
    out.push({
      week,
      start: weekStart(week),
      points: review ? review.points : live!.points,
      closed: review ? review.closed : live!.closed,
      frozen: !!review,
      current: week === thisWeek,
    });
  }
  return out;
}

/** The status a card had at a moment, from its history (null if it didn't exist yet). */
function statusAt(card: Card, t: number): { status: Status; at: string; blockedBy?: string } | null {
  let found: Card['statusHistory'][number] | null = null;
  for (const entry of card.statusHistory) {
    if (timeOf(entry.at) <= t) found = entry;
  }
  return found;
}

/** Reference notes first added during the week, from the vault's git history (empty if there's none). */
export function notesAdded(vault: string, start: string, end: string): string[] | null {
  let out: string;
  try {
    out = execFileSync('git', ['-C', vault, 'log', '-M', '--diff-filter=A', '--format=%x01%aI', '--name-only', '--', 'reference'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
  } catch {
    return null;
  }
  const names = new Set<string>();
  for (const chunk of out.split('\x01').slice(1)) {
    const [when = '', ...paths] = chunk.split('\n').filter(Boolean);
    const day = toLocalDate(new Date(when));
    if (day < start || day > end) continue;
    for (const p of paths) if (/^reference\/[^/]+\.md$/.test(p)) names.add(p.slice('reference/'.length, -3));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const cardLink = (c: { id: string; title: string }) => `[${c.title.replace(/([[\]\\])/g, '\\$1')}](#/card/${c.id})`;
const day = (date: string) => formatDay(date, 'ddd MMM D');

function weekTitle(start: string, end: string): string {
  const [sy, sm] = start.split('-');
  const [ey, em] = end.split('-');
  if (sy !== ey) return `${formatDay(start, 'MMMM D, YYYY')} – ${formatDay(end, 'MMMM D, YYYY')}`;
  if (sm !== em) return `${formatDay(start, 'MMMM D')} – ${formatDay(end, 'MMMM D, YYYY')}`;
  return `${formatDay(start, 'MMMM D')}–${formatDay(end, 'D, YYYY')}`;
}

export interface ReviewInput {
  summary: WeekSummary;
  cards: Card[]; // on the board and archived (not deleted)
  history: WeekPoints[];
  newNotes: string[] | null;
  reflection: string;
  now: Date;
}

export function renderReview({ summary, cards, history, newNotes, reflection, now }: ReviewInput): string {
  const { week, start, end } = summary;
  const begin = new Date(`${start}T00:00:00`).getTime(); // local midnight
  const finish = new Date(`${addDays(end, 1)}T00:00:00`).getTime();

  const before = history.filter((h) => h.week < week);
  const last = before.find((h) => h.week === shiftWeek(week, -1));
  const prior4 = before.filter((h) => h.week >= shiftWeek(week, -4));

  const meta = {
    week,
    start,
    end,
    points: summary.points,
    closed: summary.closed,
    completionPoints: summary.completionPoints,
    unblockBonus: summary.bonusPoints,
    generated: toLocalIso(now),
  };

  const lines: string[] = [`---\n${YAML.stringify(meta).trimEnd()}\n---`, `# Week ${Number(week.slice(6))} · ${weekTitle(start, end)}`, ''];
  lines.push(`**${formatPoints(summary.points)} points** · ${summary.closed} card${summary.closed === 1 ? '' : 's'} closed`, '');
  if (summary.points > 0) {
    lines.push('| | Cards | Points |', '|---|--:|--:|');
    for (const e of [...EFFORTS].reverse()) {
      const n = summary.closedByEffort[e];
      if (n) lines.push(`| ${EFFORT_NAME[e]} | ${n} | ${formatPoints(summary.events.filter((x) => x.kind === 'complete' && x.effort === e).reduce((s, x) => s + x.points, 0))} |`);
    }
    if (summary.bonuses) lines.push(`| Unblock bonus | ${summary.bonuses} | ${formatPoints(summary.bonusPoints)} |`);
    lines.push('');
  }
  const compare: string[] = [];
  if (last) {
    const diff = summary.points - last.points;
    compare.push(`Last week: ${formatPoints(last.points)} (${diff >= 0 ? '+' : '−'}${formatPoints(Math.abs(diff))})`);
  }
  if (prior4.length) {
    const avg = Math.round(prior4.reduce((s, h) => s + h.points, 0) / prior4.length);
    compare.push(`${prior4.length === 4 ? '4-week' : `${prior4.length}-week`} average: ${formatPoints(avg)}`);
  }
  lines.push(compare.length ? compare.join(' · ') : 'Your first week in Mindscape.', '');

  lines.push('## Closed');
  const closed = summary.events.filter((e) => e.kind === 'complete');
  if (closed.length) for (const e of closed) lines.push(`- ${cardLink({ id: e.cardId, title: e.title })} — ${EFFORT_NAME[e.effort]} · ${day(toLocalDate(new Date(e.at)))}`);
  else lines.push('Nothing closed this week.');
  const unblocked = summary.events.filter((e) => e.kind === 'unblock');
  if (unblocked.length) {
    lines.push('', 'Unblocked (+bonus):');
    for (const e of unblocked) lines.push(`- ${cardLink({ id: e.cardId, title: e.title })} — ${day(toLocalDate(new Date(e.at)))}`);
  }

  lines.push('', '## Blocked all week');
  const blocked = cards.filter((c) => {
    const at = statusAt(c, begin);
    return at?.status === 'blocked' && !c.statusHistory.some((h) => timeOf(h.at) > begin && timeOf(h.at) < finish);
  });
  if (blocked.length) {
    for (const c of blocked) {
      const why = statusAt(c, begin)?.blockedBy;
      lines.push(`- ${cardLink(c)}${why ? ` — waiting on ${why}` : ''}`);
    }
  } else lines.push('Nothing sat blocked all week.');

  lines.push('', '## Gone quiet');
  const quiet = cards
    .map((c) => {
      const at = statusAt(c, finish - 1);
      if (at?.status !== 'in-progress') return null;
      const touched = Math.max(timeOf(at.at), timeOf(c.updated) < finish ? timeOf(c.updated) : 0);
      const days = Math.floor((finish - touched) / DAY_MS);
      return days >= STALE_DAYS ? { c, days } : null;
    })
    .filter((x): x is { c: Card; days: number } => !!x)
    .sort((a, b) => b.days - a.days);
  if (quiet.length) for (const { c, days } of quiet) lines.push(`- ${cardLink(c)} — In Progress, untouched ${days} days`);
  else lines.push(`No In Progress card went ${STALE_DAYS}+ days untouched.`);

  lines.push('', '## New reference notes');
  if (newNotes === null) lines.push('(Not known: the vault has no history yet.)');
  else if (newNotes.length) for (const n of newNotes) lines.push(`- [[${n}]]`);
  else lines.push('None this week.');

  lines.push('', '## Reflection', '');
  if (reflection.trim()) lines.push(reflection.trim(), '');
  return lines.join('\n');
}

export interface ReviewContext {
  vault: string;
  files: VaultFiles;
  store: CardStore;
  rules: PointsRules;
}

/** Write (or rewrite) one week's review, keeping its Reflection. Weeks that haven't ended can't be reviewed. */
export function writeReview(ctx: ReviewContext, week: string, now: Date = new Date()): { ok: true; path: string } | { ok: false; error: string } {
  if (!isWeek(week)) return { ok: false, error: 'week must look like 2026-W42' };
  if (week >= currentWeek(now)) return { ok: false, error: 'That week isn’t over yet.' };
  const path = reviewPath(week);
  const existing = ctx.files.read(path);
  const parsed = existing === null ? null : parseReview(existing);
  if (existing !== null && !parsed) return { ok: false, error: `${path} isn’t a Mindscape review, so it was left alone.` };
  const reflection = parsed?.reflection ?? '';
  const all = ctx.store.pointsCards();
  const summary = summarizeWeek(allEvents(all, ctx.rules), week);
  const visible = [...ctx.store.list().cards, ...ctx.store.listArchived()];
  // Compare against live or frozen totals, but never this week's own old total.
  const history = pointsHistory(all, ctx.files, ctx.rules, now).filter((h) => h.week !== week);
  const text = renderReview({
    summary,
    cards: visible,
    history,
    newNotes: notesAdded(ctx.vault, summary.start, summary.end),
    reflection,
    now,
  });
  ctx.files.write(path, text);
  return { ok: true, path };
}

/** Write any missing reviews for weeks that have ended, oldest first. Returns the weeks written. */
export function writeDueReviews(ctx: ReviewContext, now: Date = new Date()): string[] {
  const thisWeek = currentWeek(now);
  const firstActivity = ctx.store
    .pointsCards()
    .flatMap((c) => c.statusHistory.map((h) => h.at))
    .map((at) => weekOf(toLocalDate(new Date(at))))
    .reduce((a, b) => (a < b ? a : b), thisWeek);
  const earliest = shiftWeek(thisWeek, -BACKFILL_WEEKS);
  const written: string[] = [];
  for (let week = firstActivity > earliest ? firstActivity : earliest; week < thisWeek; week = shiftWeek(week, 1)) {
    if (ctx.files.exists(reviewPath(week))) continue;
    if (writeReview(ctx, week, now).ok) written.push(week);
  }
  return written;
}

/** Replace a review's Reflection. `base` is the reflection editing started from, for spotting edits made elsewhere. */
export function saveReflection(
  files: VaultFiles,
  week: string,
  reflection: string,
  base?: string,
): { ok: true; reflection: string } | { ok: false; reason: 'not-found' | 'conflict'; reflection?: string } {
  const path = reviewPath(week);
  const text = files.read(path);
  const parsed = text ? parseReview(text) : null;
  if (!text || !parsed) return { ok: false, reason: 'not-found' };
  if (base !== undefined && base.trim() !== parsed.reflection) return { ok: false, reason: 'conflict', reflection: parsed.reflection };
  const at = REFLECTION.exec(text);
  const head = at ? text.slice(0, at.index) : `${text.trimEnd()}\n\n`;
  const next = `${head}## Reflection\n\n${reflection.trim() ? `${reflection.trim()}\n` : ''}`;
  files.write(path, next);
  return { ok: true, reflection: reflection.trim() };
}
