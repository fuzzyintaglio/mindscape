// Card storage on disk. Every change is a set of file operations recorded as an
// undo entry (see files.ts), so Undo restores files exactly — including status
// history, which is what points are computed from.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
import { VaultFiles } from './files.ts';
import { refName, toRef } from './links.ts';
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
  /** Linked reference notes, by name. */
  refs?: string[];
}

export type UpdateResult =
  | { ok: true; card: StoredCard; undoId: string | null }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'conflict'; card: StoredCard };

export class CardStore {
  readonly files: VaultFiles;

  constructor(
    readonly vault: string,
    files?: VaultFiles,
  ) {
    this.files = files ?? new VaultFiles(vault);
  }

  private abs(rel: string) {
    return this.files.abs(rel);
  }

  private read(rel: string): string | null {
    return this.files.read(rel);
  }

  private write(rel: string, text: string | null) {
    this.files.write(rel, text);
  }

  private apply(changes: { path: string; after: string | null }[]): string {
    return this.files.apply(changes);
  }

  undo(undoId: string) {
    return this.files.undo(undoId);
  }

  private cardFiles(folder: string, deep = false): string[] {
    return this.files.markdownFiles(folder, deep);
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

  /** Archived cards (archive/<year>/), skipping unreadable files. */
  listArchived(): StoredCard[] {
    return this.listFolder('archive', true).cards;
  }

  /** Archived cards plus any files that couldn't be read, for the Archive view. */
  archive(): { cards: StoredCard[]; problems: FileProblem[] } {
    return this.listFolder('archive', true);
  }

  private listFolder(folder: string, deep: boolean): { cards: StoredCard[]; problems: FileProblem[] } {
    const cards: StoredCard[] = [];
    const problems: FileProblem[] = [];
    for (const rel of this.cardFiles(folder, deep)) {
      try {
        cards.push(this.load(rel).stored);
      } catch (err) {
        problems.push({ path: rel, error: (err as Error).message });
      }
    }
    return { cards, problems };
  }

  /**
   * Every card whose history counts for points: on the board, archived, and deleted
   * (in .trash/), so deleting or archiving never changes a total. One per id.
   */
  pointsCards(): StoredCard[] {
    const byId = new Map<string, StoredCard>();
    for (const card of [...this.list().cards, ...this.listArchived(), ...this.listFolder('.trash', false).cards]) {
      if (!byId.has(card.id)) byId.set(card.id, card);
    }
    return [...byId.values()];
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

  /** An active or archived card. */
  getAny(id: string): StoredCard | undefined {
    return this.get(id) ?? this.listArchived().find((c) => c.id === id);
  }

  private freePath(folder: string, title: string, keep?: string): string {
    return this.files.freePath(folder, slugify(title), keep);
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
    if (patch.refs !== undefined) {
      const refs = uniqueRefs(patch.refs);
      if (refs.join('\n') !== card.refs.join('\n')) card = { ...card, refs, updated: now };
    }
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

  /** Add a line to the end of a card's app-managed Log. */
  appendLog(id: string, line: string): { ok: true; card: StoredCard; undoId: string } | { ok: false } {
    const found = this.find(id);
    if (!found) return { ok: false };
    const { stored, extra } = found;
    const { path, rev: _rev, ...current } = stored;
    const card: Card = { ...current, log: current.log ? `${current.log}\n${line}` : line, updated: toLocalIso() };
    const text = serializeCard(card, extra);
    const undoId = this.apply([{ path, after: text }]);
    return { ok: true, card: { ...card, path, rev: revOf(text) }, undoId };
  }

  /**
   * Put an archived card back on the board, in In Progress. Leaving Complete takes
   * its points back until it's completed again, as with any other move.
   */
  restore(id: string): { ok: true; card: StoredCard; undoId: string } | { ok: false } {
    let found: { stored: StoredCard; extra: Record<string, unknown> } | undefined;
    for (const rel of this.cardFiles('archive', true)) {
      try {
        const loaded = this.load(rel);
        if (loaded.stored.id === id) found = loaded;
      } catch {
        // reported by archive()
      }
      if (found) break;
    }
    if (!found) return { ok: false };
    const { path, rev: _rev, ...plain } = found.stored;
    const card = moveCard({ ...plain, archived: null }, 'in-progress', toLocalIso());
    const text = serializeCard(card, found.extra);
    const dest = this.freePath('tasks', card.title);
    const undoId = this.apply([
      { path, after: null },
      { path: dest, after: text },
    ]);
    return { ok: true, card: { ...card, path: dest, rev: revOf(text) }, undoId };
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

/** Names → `[[Name]]` refs, dropping blanks and case-insensitive duplicates, keeping order. */
function uniqueRefs(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = refName(raw).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(toRef(name));
  }
  return out;
}

const WELCOME_NOTES = `This is a card. Here's how the board works:

- **Add a card** with "+ Add card" at the bottom of any column. Type a title and press Enter.
- **Effort** is the little L / M / H chip. Click it to cycle. High cards sit on top, then Medium, then Low; within each, whoever has waited longest is first.
- **Move a card** by dragging it to another column. Moving to *Blocked* asks what's blocking it.
- **Open a card** (like you just did) to see its notes. Click the notes to edit, then **Save** (or ⌘S).
- **Undo** — every move and delete shows an Undo button for a few seconds.
- **Link a reference note** with "+ Link note" above. Its text shows right here in the card.
- Complete cards move to the archive 7 days after you finish them. Nothing is ever lost.

Up top: **Daily** is today's note (it saves as you type), **Notes** holds your reference notes, and the **Capture** box (⌘J) drops a line into today's note from anywhere. Start a capture with \`t:\` to make a card instead.

You can delete this card whenever you like.`;
