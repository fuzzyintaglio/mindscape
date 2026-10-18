import type { CaptureResult } from '../../core/capture.ts';
import type { Effort, Status, StoredCard } from '../../core/cards.ts';
import type { Theme, VaultConfig } from '../../core/configDefaults.ts';
import type { Note, NoteSummary } from '../../core/notes.ts';

export type { CaptureResult, Note, NoteSummary };

export interface FileProblem {
  path: string;
  error: string;
}

export interface BoardData {
  cards: StoredCard[];
  problems: FileProblem[];
  config: VaultConfig;
}

export interface CardPatch {
  title?: string;
  effort?: Effort;
  status?: Status;
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
  deleteNote: (name: string) => request<{ undoId: string }>(notePath(name), json('DELETE')),
};

function notePath(name: string) {
  return `/api/notes/${encodeURIComponent(name)}`;
}
