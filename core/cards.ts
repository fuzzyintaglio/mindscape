// Card model and the board rules. Pure functions only — no file access — so the
// server, the UI, and the CLI all share exactly the same behavior.
import { refName, sameName } from './links.ts';
import { DAY_MS, daysBetween, timeOf, toLocalDate } from './time.ts';

export const STATUSES = ['not-started', 'in-progress', 'blocked', 'complete'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  blocked: 'Blocked',
  complete: 'Complete',
};

export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];

const EFFORT_RANK: Record<Effort, number> = { high: 0, medium: 1, low: 2 };

export interface HistoryEntry {
  status: Status;
  at: string;
  blockedBy?: string;
  unblockBy?: string;
  /** The id of the card it was waiting on. */
  blockedByCard?: string;
}

export interface Card {
  id: string;
  title: string;
  status: Status;
  effort: Effort;
  refs: string[];
  due: string | null; // a date, YYYY-MM-DD
  created: string;
  updated: string;
  enteredColumn: string;
  completed: string | null;
  archived: string | null;
  blockedBy: string | null;
  unblockBy: string | null; // a date, YYYY-MM-DD
  /** Blocked by another card (its id), instead of or as well as the free-text blocker. */
  blockedByCard: string | null;
  statusHistory: HistoryEntry[];
  notes: string; // markdown under "## Notes" — the part the user edits
  log: string; // markdown under "## Log" — managed by the app (intake)
}

/** A card plus where it lives on disk and a fingerprint of its file, for conflict checks. */
export interface StoredCard extends Card {
  path: string;
  rev: string;
}

export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);
}

export function nextEffort(e: Effort): Effort {
  return e === 'low' ? 'medium' : e === 'medium' ? 'high' : 'low';
}

/** Board order within a column: High → Medium → Low, then whoever has waited longest in the column. */
export function compareCards(a: Card, b: Card): number {
  return (
    EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] ||
    timeOf(a.enteredColumn) - timeOf(b.enteredColumn) ||
    a.title.localeCompare(b.title)
  );
}

export function newCard(fields: { id: string; title: string; status?: Status; effort?: Effort; due?: string | null; now: string }): Card {
  const status = fields.status ?? 'not-started';
  return {
    id: fields.id,
    title: fields.title.trim(),
    status,
    effort: fields.effort ?? 'medium',
    refs: [],
    due: fields.due ?? null,
    created: fields.now,
    updated: fields.now,
    enteredColumn: fields.now,
    completed: status === 'complete' ? fields.now : null,
    archived: null,
    blockedBy: null,
    unblockBy: null,
    blockedByCard: null,
    statusHistory: [{ status, at: fields.now }],
    notes: '',
    log: '',
  };
}

/**
 * Move a card to another column. Records history and time-in-column, sets or
 * clears `completed`, and files the blocker text into history when leaving Blocked.
 */
export function moveCard(card: Card, to: Status, now: string): Card {
  if (card.status === to) return card;
  const next: Card = {
    ...card,
    status: to,
    updated: now,
    enteredColumn: now,
    statusHistory: [...card.statusHistory, { status: to, at: now }],
    completed: to === 'complete' ? now : null,
  };
  if (card.status === 'blocked') {
    next.blockedBy = null;
    next.unblockBy = null;
    next.blockedByCard = null;
  }
  return next;
}

/** Set the blocker fields on a Blocked card, mirroring them into its latest history entry. */
export function setBlocker(card: Card, blockedBy: string | null, unblockBy: string | null, now: string, blockedByCard: string | null = card.blockedByCard): Card {
  if (card.status !== 'blocked') return card;
  const history = [...card.statusHistory];
  const last = history[history.length - 1];
  if (last && last.status === 'blocked') {
    const entry: HistoryEntry = { status: last.status, at: last.at };
    if (blockedBy) entry.blockedBy = blockedBy;
    if (unblockBy) entry.unblockBy = unblockBy;
    if (blockedByCard) entry.blockedByCard = blockedByCard;
    history[history.length - 1] = entry;
  }
  return { ...card, blockedBy: blockedBy || null, unblockBy: unblockBy || null, blockedByCard: blockedByCard || null, statusHistory: history, updated: now };
}

/**
 * For a card blocked by another card: is that card done? True when it's Complete, or no
 * longer on the board (archived, or deleted). Null when the card isn't waiting on a card.
 */
export function blockerDone(card: Card, board: Card[]): boolean | null {
  if (card.status !== 'blocked' || !card.blockedByCard) return null;
  const blocker = board.find((c) => c.id === card.blockedByCard);
  return !blocker || blocker.status === 'complete';
}

/** Ids of cards that some Blocked card is waiting on, with how many wait on each. */
export function blockingCounts(board: Card[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of board) {
    if (c.status !== 'blocked' || !c.blockedByCard) continue;
    const blocker = board.find((b) => b.id === c.blockedByCard);
    if (blocker && blocker.status !== 'complete') counts.set(blocker.id, (counts.get(blocker.id) ?? 0) + 1);
  }
  return counts;
}

/** True when a Blocked card's expected unblock date is today or earlier. */
export function isUnblockDue(card: Card, today: string = toLocalDate()): boolean {
  return card.status === 'blocked' && !!card.unblockBy && card.unblockBy <= today;
}

/** A card due within this many days gets a "due soon" marker. */
export const DUE_SOON_DAYS = 7;

export type DueState = 'overdue' | 'soon';

/** Overdue, due within a week, or neither. Complete cards never show a marker. */
export function dueState(card: Card, today: string = toLocalDate()): DueState | null {
  if (!card.due || card.status === 'complete') return null;
  const days = daysBetween(today, card.due);
  if (days < 0) return 'overdue';
  return days <= DUE_SOON_DAYS ? 'soon' : null;
}

// ── Board filters ──────────────────────────────────────
// Calendar-based windows: this week runs through Sunday, then the month, then the quarter.
export const DUE_WINDOWS = ['week', 'month', 'quarter'] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

export interface BoardFilter {
  /** Only cards linked to this reference note (its name). */
  note: string | null;
  /** Only cards due by the end of this window (overdue ones included). */
  due: DueWindow | null;
}

export const NO_FILTER: BoardFilter = { note: null, due: null };

/** The last day of the week (Sunday), month, or quarter that `today` is in. */
export function dueWindowEnd(window: DueWindow, today: string = toLocalDate()): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const at = (yy: number, mm: number, dd: number) => toLocalDate(new Date(yy, mm, dd, 12));
  if (window === 'week') {
    const weekday = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // Monday = 0
    return at(y, m - 1, d + 6 - weekday);
  }
  if (window === 'month') return at(y, m, 0);
  return at(y, Math.floor((m - 1) / 3) * 3 + 3, 0);
}

/** Complete cards always show; the filters narrow the other three columns. */
export function matchesFilter(card: Card, filter: BoardFilter, today: string = toLocalDate()): boolean {
  if (card.status === 'complete') return true;
  if (filter.note && !card.refs.some((r) => sameName(refName(r), filter.note!))) return false;
  if (filter.due && !(card.due && card.due <= dueWindowEnd(filter.due, today))) return false;
  return true;
}

/** Complete cards move to the archive this many days after completion. */
export function shouldArchive(card: Card, archiveAfterDays: number, now: Date = new Date()): boolean {
  if (card.status !== 'complete' || !card.completed || card.archived) return false;
  return now.getTime() - timeOf(card.completed) >= archiveAfterDays * DAY_MS;
}

/** File-name-safe slug for a card title. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'card';
}

/** Short, sortable, unique id (ULID-style: time prefix + random). */
export function newId(now: number = Date.now()): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = alphabet[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const b of bytes) rand += alphabet[b % 32];
  return time + rand;
}
