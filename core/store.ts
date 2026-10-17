// Card storage on disk. Every change is a set of file operations recorded as an
// undo entry, so Undo restores files exactly — including status history, which
// is what points are computed from.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type Card,
  type Effort,
  type Status,
  type StoredCard,
  moveCard,
  newCard,
  newId,
  setBlocker,
  shouldArchive,
  slugify,
} from './cards.ts';
import { parseCard, revOf, serializeCard } from './cardFile.ts';
import { toLocalIso } from './time.ts';

export interface FileProblem {
  path: string;
  error: string;
}

export interface CardPatch {
  title?: string;
  effort?: Effort;
  status?: Status;
  blockedBy?: string | null;
  unblockBy?: string | null;
  notes?: string;
  /** The notes the editor started from. If the file's notes differ, someone else edited them: conflict. */
  baseNotes?: string;
}

export type UpdateResult =
  | { ok: true; card: StoredCard; undoId: string | null }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'conflict'; card: StoredCard };

interface FileOp {
  path: string; // relative to the vault
  before: string | null; // null = file didn't exist
  after: string | null; // null = file removed
}

const UNDO_LIMIT = 50;

export class CardStore {
  private undos = new Map<string, FileOp[]>();

  constructor(readonly vault: string) {}

  private abs(rel: string) {
    return join(this.vault, rel);
  }

  private read(rel: string): string | null {
    const p = this.abs(rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }

  /** Write via a temp file + rename, so a crash never leaves a half-written card. */
  private write(rel: string, text: string | null) {
    const p = this.abs(rel);
    if (text === null) {
      rmSync(p, { force: true });
      return;
    }
    mkdirSync(dirname(p), { recursive: true });
    const tmp = join(dirname(p), `.${basename(p)}.tmp-${process.pid}`);
    writeFileSync(tmp, text);
    renameSync(tmp, p);
  }

  /** Apply file changes together and remember how to undo them. */
  private apply(changes: { path: string; after: string | null }[]): string {
    const ops: FileOp[] = changes.map((c) => ({ path: c.path, before: this.read(c.path), after: c.after }));
    for (const op of ops) this.write(op.path, op.after);
    const undoId = newId();
    this.undos.set(undoId, ops);
    while (this.undos.size > UNDO_LIMIT) this.undos.delete(this.undos.keys().next().value!);
    return undoId;
  }

  /** Undo a change, unless any of its files changed again since (never clobber newer edits). */
  undo(undoId: string): { ok: true } | { ok: false; reason: 'expired' | 'changed' } {
    const ops = this.undos.get(undoId);
    if (!ops) return { ok: false, reason: 'expired' };
    if (ops.some((op) => this.read(op.path) !== op.after)) return { ok: false, reason: 'changed' };
    for (const op of [...ops].reverse()) this.write(op.path, op.before);
    this.undos.delete(undoId);
    return { ok: true };
  }

  private cardFiles(folder: string): string[] {
    const dir = this.abs(folder);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map((e) => `${folder}/${e.name}`);
  }

  private load(rel: string): { stored: StoredCard; extra: Record<string, unknown> } {
    const text = this.read(rel) ?? '';
    const { card, extra } = parseCard(text);
    return { stored: { ...card, path: rel, rev: revOf(text) }, extra };
  }

  /** Active cards (tasks/), plus any files that couldn't be read. */
  list(): { cards: StoredCard[]; problems: FileProblem[] } {
    const cards: StoredCard[] = [];
    const problems: FileProblem[] = [];
    for (const rel of this.cardFiles('tasks')) {
      try {
        cards.push(this.load(rel).stored);
      } catch (err) {
        problems.push({ path: rel, error: (err as Error).message });
      }
    }
    return { cards, problems };
  }

  private find(id: string): { stored: StoredCard; extra: Record<string, unknown> } | undefined {
    for (const rel of this.cardFiles('tasks')) {
      try {
        const loaded = this.load(rel);
        if (loaded.stored.id === id) return loaded;
      } catch {
        // unreadable files are reported by list()
      }
    }
    return undefined;
  }

  get(id: string): StoredCard | undefined {
    return this.find(id)?.stored;
  }

  /** A free path like tasks/my-card.md, tasks/my-card-2.md, … (`keep` is allowed to be reused). */
  private freePath(folder: string, title: string, keep?: string): string {
    const slug = slugify(title);
    for (let n = 1; ; n++) {
      const rel = `${folder}/${n === 1 ? slug : `${slug}-${n}`}.md`;
      if (rel === keep || !existsSync(this.abs(rel))) return rel;
    }
  }

  create(fields: { title: string; status?: Status; effort?: Effort; notes?: string }): { card: StoredCard; undoId: string } {
    const now = toLocalIso();
    const card: Card = { ...newCard({ id: newId(), title: fields.title, status: fields.status, effort: fields.effort, now }), notes: fields.notes ?? '' };
    const rel = this.freePath('tasks', card.title);
    const text = serializeCard(card);
    const undoId = this.apply([{ path: rel, after: text }]);
    return { card: { ...card, path: rel, rev: revOf(text) }, undoId };
  }

  /**
   * Update a card. Pass `rev` (the fingerprint the client last saw) to refuse the
   * change if the file was modified elsewhere in the meantime.
   */
  update(id: string, patch: CardPatch, rev?: string): UpdateResult {
    const found = this.find(id);
    if (!found) return { ok: false, reason: 'not-found' };
    const { stored, extra } = found;
    if (rev && rev !== stored.rev) return { ok: false, reason: 'conflict', card: stored };
    if (patch.baseNotes !== undefined && patch.baseNotes.trim() !== stored.notes) return { ok: false, reason: 'conflict', card: stored };

    const now = toLocalIso();
    const { path: oldPath, rev: _rev, ...current } = stored;
    let card: Card = current;
    if (patch.status && patch.status !== card.status) card = moveCard(card, patch.status, now);
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== card.title) card = { ...card, title: patch.title.trim(), updated: now };
    if (patch.effort && patch.effort !== card.effort) card = { ...card, effort: patch.effort, updated: now };
    if (patch.notes !== undefined && patch.notes.trim() !== card.notes) card = { ...card, notes: patch.notes.trim(), updated: now };
    if ((patch.blockedBy !== undefined || patch.unblockBy !== undefined) && card.status === 'blocked') {
      card = setBlocker(
        card,
        patch.blockedBy !== undefined ? patch.blockedBy?.trim() || null : card.blockedBy,
        patch.unblockBy !== undefined ? patch.unblockBy || null : card.unblockBy,
        now,
      );
    }
    if (card === current) return { ok: true, card: stored, undoId: null };

    const text = serializeCard(card, extra);
    const newPath = card.title !== stored.title ? this.freePath('tasks', card.title, oldPath) : oldPath;
    const changes = newPath === oldPath ? [{ path: oldPath, after: text }] : [{ path: oldPath, after: null }, { path: newPath, after: text }];
    const undoId = this.apply(changes);
    return { ok: true, card: { ...card, path: newPath, rev: revOf(text) }, undoId };
  }

  /** Delete = move to .trash/. Nothing is ever hard-deleted. */
  remove(id: string): { ok: true; undoId: string } | { ok: false } {
    const found = this.find(id);
    if (!found) return { ok: false };
    const text = this.read(found.stored.path);
    const trashPath = this.freePath('.trash', found.stored.title);
    const undoId = this.apply([
      { path: found.stored.path, after: null },
      { path: trashPath, after: text },
    ]);
    return { ok: true, undoId };
  }

  /** Move Complete cards older than `days` into archive/<year>/. Returns how many moved. */
  archiveDue(days: number, now: Date = new Date()): number {
    let moved = 0;
    for (const card of this.list().cards) {
      if (!shouldArchive(card, days, now)) continue;
      const found = this.find(card.id)!;
      const { path, rev: _rev, ...plain } = found.stored;
      const archived: Card = { ...plain, archived: toLocalIso(now) };
      const year = (card.completed ?? '').slice(0, 4) || String(now.getFullYear());
      const dest = this.freePath(`archive/${year}`, card.title);
      // Not undoable from the UI: this is housekeeping, not a user action.
      this.write(dest, serializeCard(archived, found.extra));
      this.write(path, null);
      moved++;
    }
    return moved;
  }

  /** First run: if the vault has never been opened, add one sample card that explains the basics. */
  ensureWelcome(): boolean {
    const stateFile = this.abs('.mindscape/state.json');
    const state = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>) : {};
    if (state.welcomedAt) return false;
    if (this.cardFiles('tasks').length === 0) {
      this.create({ title: 'Welcome to Mindscape — click me', effort: 'low', notes: WELCOME_NOTES });
    }
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ ...state, welcomedAt: toLocalIso() }, null, 2) + '\n');
    return true;
  }
}

const WELCOME_NOTES = `This is a card. Here's how the board works:

- **Add a card** with "+ Add card" at the bottom of any column. Type a title and press Enter.
- **Effort** is the little L / M / H chip. Click it to cycle. High cards sit on top, then Medium, then Low; within each, whoever has waited longest is first.
- **Move a card** by dragging it to another column. Moving to *Blocked* asks what's blocking it.
- **Open a card** (like you just did) to see its notes. Click the notes to edit, then **Save** (or ⌘S).
- **Undo** — every move and delete shows an Undo button for a few seconds.
- Complete cards move to the archive 7 days after you finish them. Nothing is ever lost.

You can delete this card whenever you like.`;
