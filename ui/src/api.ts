import type { CaptureResult } from '../../core/capture.ts';
import type { Effort, Status, StoredCard } from '../../core/cards.ts';
import type { Theme, VaultConfig } from '../../core/configDefaults.ts';
import type { Note, NoteSummary } from '../../core/notes.ts';
import type { DayPins } from '../../core/pins.ts';
import type { WeekStrip } from '../../core/points.ts';
import type { ProposalEdits, ReviewItem } from '../../core/intakeTypes.ts';
import type { SearchHit } from '../../core/searchTypes.ts';

export type { CaptureResult, DayPins, Note, NoteSummary, ProposalEdits, ReviewItem, SearchHit, WeekStrip };

export interface ReviewSummary {
  week: string;
  start: string;
  end: string;
  points: number;
  closed: number;
  path: string;
}

export interface Review extends ReviewSummary {
  body: string;
  reflection: string;
}

export interface About {
  version: string;
  vaultPath: string;
  builtAt: string | null;
  commit: string | null;
  commitDate: string | null;
}

export interface WeekPoints {
  week: string;
  start: string;
  points: number;
  closed: number;
  frozen: boolean;
  current: boolean;
}

export interface Decision {
  runId: string;
  id: string;
  action: 'accept' | 'reject';
  edits?: ProposalEdits;
}

export interface DecideResult {
  results: { runId: string; id: string; ok: boolean; error?: string }[];
  summary: string;
  undoId: string | null;
}

export interface FileProblem {
  path: string;
  error: string;
}

export interface BoardData {
  cards: StoredCard[];
  problems: FileProblem[];
  config: VaultConfig;
  points: WeekStrip;
  intakePending: number;
  unprocessedDays: number;
  /** Today's pins. */
  pins: DayPins;
}

export interface CardPatch {
  title?: string;
  effort?: Effort;
  status?: Status;
  due?: string | null;
  blockedBy?: string | null;
  unblockBy?: string | null;
  notes?: string;
  baseNotes?: string;
  refs?: string[];
  rev?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === 'string' ? body.error : `Request failed (${status})`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  board: () => request<BoardData>('/api/board'),
  createCard: (title: string, status: Status) =>
    request<{ card: StoredCard; undoId: string }>('/api/cards', json('POST', { title, status })),
  updateCard: (id: string, patch: CardPatch) =>
    request<{ card: StoredCard; undoId: string | null }>(`/api/cards/${id}`, json('PATCH', patch)),
  stickies: (date: string) => request<{ date: string; items: string[] }>(`/api/stickies/${date}`),
  saveStickies: (date: string, items: string[]) => request<{ date: string; items: string[] }>(`/api/stickies/${date}`, json('PUT', { items })),
  pin: (id: string) => request<{ pins: DayPins }>('/api/pins', json('POST', { id })),
  unpin: (id: string) => request<{ pins: DayPins }>(`/api/pins/${id}`, json('DELETE')),
  deleteCard: (id: string) => request<{ undoId: string }>(`/api/cards/${id}`, json('DELETE')),
  undo: (undoId: string) => request<{ ok: true }>(`/api/undo/${undoId}`, json('POST')),
  setTheme: (theme: Theme) => request<VaultConfig>('/api/config', json('PATCH', { theme })),

  daily: (date: string, create = false) => request<{ date: string; text: string | null }>(`/api/daily/${date}${create ? '?create=1' : ''}`),
  saveDaily: (date: string, text: string, base: string | null, force = false) =>
    request<{ date: string; text: string }>(`/api/daily/${date}`, json('PUT', { text, base, force })),
  capture: (text: string) => request<CaptureResult>('/api/capture', json('POST', { text })),

  notes: () => request<{ notes: NoteSummary[] }>('/api/notes'),
  note: (name: string) => request<{ note: Note }>(notePath(name)),
  createNote: (name: string, text = '') => request<{ note: Note; undoId: string }>('/api/notes', json('POST', { name, text })),
  saveNote: (name: string, text: string, baseText: string) => request<{ note: Note }>(notePath(name), json('PUT', { text, baseText })),
  renameNote: (name: string, next: string) =>
    request<{ note: Note; undoId: string | null; updated: number }>(notePath(name), json('PATCH', { name: next })),
  intake: () => request<{ items: ReviewItem[] }>('/api/intake'),
  runMindscape: (includeToday: boolean) => request<{ ok: true; skill: 'installed' | 'current' }>('/api/intake/run', json('POST', { includeToday })),
  decide: (decisions: Decision[]) => request<DecideResult>('/api/intake/decide', json('POST', { decisions })),
  search: (q: string) => request<{ q: string; results: SearchHit[]; ms: number }>(`/api/search?q=${encodeURIComponent(q)}`),
  card: (id: string) => request<{ card: StoredCard }>(`/api/cards/${id}`),
  about: () => request<About>('/api/about'),
  archive: () => request<{ cards: StoredCard[]; problems: FileProblem[] }>('/api/archive'),
  restoreCard: (id: string) => request<{ card: StoredCard; undoId: string }>(`/api/cards/${id}/restore`, json('POST')),
  reviews: () => request<{ reviews: ReviewSummary[]; history: WeekPoints[] }>('/api/reviews'),
  review: (week: string) => request<{ review: Review }>(`/api/reviews/${week}`),
  writeReview: (week: string) => request<{ ok: true; path: string }>(`/api/reviews/${week}`, json('POST')),
  saveReflection: (week: string, text: string, base: string) =>
    request<{ ok: true; reflection: string }>(`/api/reviews/${week}/reflection`, json('PUT', { text, base })),
  deleteNote: (name: string) => request<{ undoId: string }>(notePath(name), json('DELETE')),
};

function notePath(name: string) {
  return `/api/notes/${encodeURIComponent(name)}`;
}
