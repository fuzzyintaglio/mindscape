import type { Effort, Status, StoredCard } from '../../core/cards.ts';
import type { Theme, VaultConfig } from '../../core/configDefaults.ts';

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
};
