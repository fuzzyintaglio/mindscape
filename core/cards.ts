// Card model and the board rules. Pure functions only — no file access — so the
// server, the UI, and the CLI all share exactly the same behavior.
import { DAY_MS, timeOf, toLocalDate } from './time.ts';

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
}

export interface Card {
  id: string;
  title: string;
  status: Status;
  effort: Effort;
  refs: string[];
  created: string;
  updated: string;
  enteredColumn: string;
  completed: string | null;
  archived: string | null;
  blockedBy: string | null;
  unblockBy: string | null; // a date, YYYY-MM-DD
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

export function newCard(fields: { id: string; title: string; status?: Status; effort?: Effort; now: string }): Card {
  const status = fields.status ?? 'not-started';
  return {
    id: fields.id,
    title: fields.title.trim(),
    status,
    effort: fields.effort ?? 'medium',
    refs: [],
    created: fields.now,
    updated: fields.now,
    enteredColumn: fields.now,
    completed: status === 'complete' ? fields.now : null,
    archived: null,
    blockedBy: null,
    unblockBy: null,
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
  }
  return next;
}

/** Set the blocker fields on a Blocked card, mirroring them into its latest history entry. */
export function setBlocker(card: Card, blockedBy: string | null, unblockBy: string | null, now: string): Card {
  if (card.status !== 'blocked') return card;
  const history = [...card.statusHistory];
  const last = history[history.length - 1];
  if (last && last.status === 'blocked') {
    const entry: HistoryEntry = { status: last.status, at: last.at };
    if (blockedBy) entry.blockedBy = blockedBy;
    if (unblockBy) entry.unblockBy = unblockBy;
    history[history.length - 1] = entry;
  }
  return { ...card, blockedBy: blockedBy || null, unblockBy: unblockBy || null, statusHistory: history, updated: now };
}

/** True when a Blocked card's expected unblock date is today or earlier. */
export function isUnblockDue(card: Card, today: string = toLocalDate()): boolean {
  return card.status === 'blocked' && !!card.unblockBy && card.unblockBy <= today;
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
