// Reference notes: reference/<Name>.md. The file name is the note's name (so
// [[Name]] works in Obsidian too) and the whole file is the note's text.
// Links live on cards (`refs`); "Linked cards" is worked out from those.
import type { Status, StoredCard } from './cards.ts';
import { revOf } from './cardFile.ts';
import type { VaultFiles } from './files.ts';
import { cleanNoteName, refName, rewriteLinks, sameName } from './links.ts';
import { ARCHIVED_NOTES, type CardStore } from './store.ts';
import { DAY_MS } from './time.ts';

const FOLDER = 'reference';

/** A note no one has touched for this many days, and that no active card links to, is stale. */
export const STALE_NOTE_DAYS = 30;

export interface NoteSummary {
  name: string;
  path: string;
  modified: string;
  preview: string;
  linkedCards: number;
  /** Untouched for 30+ days and not linked to any card still in play: a candidate for the archive. */
  stale: boolean;
}

export interface LinkedCard {
  id: string;
  title: string;
  status: Status;
  archived: boolean;
}

export interface Note {
  name: string;
  path: string;
  text: string;
  rev: string;
  modified: string;
  cards: LinkedCard[];
  /** True for a note in archive/notes/. */
  archived: boolean;
}

export type NoteError = { ok: false; reason: 'not-found' | 'exists' | 'invalid' | 'conflict'; note?: Note };

const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1, -'.md'.length);

/** First line of real text, for the list view. */
function previewOf(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const line = body.split('\n').find((l) => l.trim() && !/^#{1,6}\s/.test(l)) ?? '';
  return line.replace(/^[-*>\s]+/, '').trim().slice(0, 140);
}

export class NoteStore {
  constructor(
    private readonly files: VaultFiles,
    private readonly cards: CardStore,
  ) {}

  private paths(): string[] {
    return this.files.markdownFiles(FOLDER);
  }

  /** Find a note's file by name, case-insensitively (like Obsidian and macOS). */
  private pathOf(name: string): string | undefined {
    return this.paths().find((p) => sameName(nameOf(p), name));
  }

  private allCards(): StoredCard[] {
    return [...this.cards.list().cards, ...this.cards.listArchived()];
  }

  private linkedTo(name: string, cards = this.allCards()): LinkedCard[] {
    return cards
      .filter((c) => c.refs.some((r) => sameName(refName(r), name)))
      .map((c) => ({ id: c.id, title: c.title, status: c.status, archived: !!c.archived }));
  }

  list(now: Date = new Date()): NoteSummary[] {
    return this.summaries(this.paths(), now);
  }

  /** Archived notes, most recently changed first. */
  listArchived(now: Date = new Date()): NoteSummary[] {
    return this.summaries(this.files.markdownFiles(ARCHIVED_NOTES), now).map((n) => ({ ...n, stale: false }));
  }

  private summaries(paths: string[], now: Date): NoteSummary[] {
    const cards = this.allCards();
    return paths
      .map((path) => {
        const name = nameOf(path);
        const linked = this.linkedTo(name, cards);
        const modified = this.files.modified(path);
        const quiet = now.getTime() - Date.parse(modified) >= STALE_NOTE_DAYS * DAY_MS;
        const inPlay = linked.some((c) => !c.archived && c.status !== 'complete');
        return { name, path, modified, preview: previewOf(this.files.read(path) ?? ''), linkedCards: linked.length, stale: quiet && !inPlay };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  /** A note by name; archived notes are found too, so links to them keep working. */
  get(name: string): Note | undefined {
    const path = this.pathOf(name) ?? this.archivedPathOf(name);
    if (!path) return undefined;
    const text = this.files.read(path) ?? '';
    return {
      name: nameOf(path),
      path,
      text,
      rev: revOf(text),
      modified: this.files.modified(path),
      cards: this.linkedTo(nameOf(path)),
      archived: path.startsWith(`${ARCHIVED_NOTES}/`),
    };
  }

  private archivedPathOf(name: string): string | undefined {
    return this.files.markdownFiles(ARCHIVED_NOTES).find((p) => sameName(nameOf(p), name));
  }

  /** Move notes to archive/notes/, as one undoable change. Unknown names are skipped. */
  archive(names: string[]): { ok: true; undoId: string | null; archived: string[] } {
    const changes: { path: string; after: string | null }[] = [];
    const archived: string[] = [];
    const taken = new Set(this.files.markdownFiles(ARCHIVED_NOTES).map((p) => p.toLowerCase()));
    for (const name of names) {
      const path = this.pathOf(name);
      if (!path || archived.some((n) => sameName(n, nameOf(path)))) continue;
      let dest = `${ARCHIVED_NOTES}/${nameOf(path)}.md`;
      for (let i = 2; taken.has(dest.toLowerCase()); i++) dest = `${ARCHIVED_NOTES}/${nameOf(path)} ${i}.md`;
      taken.add(dest.toLowerCase());
      changes.push({ path, after: null }, { path: dest, after: this.files.read(path) ?? '' });
      archived.push(nameOf(path));
    }
    return { ok: true, undoId: changes.length ? this.files.apply(changes) : null, archived };
  }

  /** Every stale note, archived together. */
  archiveStale(now: Date = new Date()) {
    return this.archive(this.list(now).filter((n) => n.stale).map((n) => n.name));
  }

  /** Back from the archive into the Notes list. */
  restore(name: string): { ok: true; note: Note; undoId: string } | NoteError {
    const path = this.archivedPathOf(name);
    if (!path) return { ok: false, reason: 'not-found' };
    if (this.pathOf(nameOf(path))) return { ok: false, reason: 'exists' };
    const undoId = this.files.apply([
      { path, after: null },
      { path: `${FOLDER}/${nameOf(path)}.md`, after: this.files.read(path) ?? '' },
    ]);
    return { ok: true, note: this.get(nameOf(path))!, undoId };
  }

  create(rawName: string, text = ''): { ok: true; note: Note; undoId: string } | NoteError {
    const name = cleanNoteName(rawName);
    if (!name) return { ok: false, reason: 'invalid' };
    if (this.pathOf(name)) return { ok: false, reason: 'exists', note: this.get(name) };
    const undoId = this.files.apply([{ path: `${FOLDER}/${name}.md`, after: text }]);
    return { ok: true, note: this.get(name)!, undoId };
  }

  /** Save a note's text. `baseText` is what the editor started from; if the file differs, it's a conflict. */
  save(name: string, text: string, baseText?: string): { ok: true; note: Note } | NoteError {
    const path = this.pathOf(name);
    if (!path) return { ok: false, reason: 'not-found' };
    const current = this.files.read(path) ?? '';
    if (baseText !== undefined && baseText !== current) return { ok: false, reason: 'conflict', note: this.get(name) };
    const next = text.trim() ? `${text.trim()}\n` : '';
    if (next !== current) this.files.write(path, next);
    return { ok: true, note: this.get(name)! };
  }

  /** Add a block to the end of a note, as one undoable change. */
  append(name: string, block: string): { ok: true; note: Note; undoId: string } | NoteError {
    const path = this.pathOf(name);
    if (!path) return { ok: false, reason: 'not-found' };
    const current = (this.files.read(path) ?? '').trimEnd();
    const undoId = this.files.apply([{ path, after: `${current ? `${current}\n\n` : ''}${block.trim()}\n` }]);
    return { ok: true, note: this.get(name)!, undoId };
  }

  /**
   * Rename a note and point every link at the new name — card refs, and [[links]]
   * in cards, notes, daily notes and reviews — as one undoable change.
   */
  rename(name: string, rawNext: string): { ok: true; note: Note; undoId: string | null; updated: number } | NoteError {
    const path = this.pathOf(name);
    if (!path) return { ok: false, reason: 'not-found' };
    const old = nameOf(path);
    const next = cleanNoteName(rawNext);
    if (!next) return { ok: false, reason: 'invalid' };
    if (next === old) return { ok: true, note: this.get(old)!, undoId: null, updated: 0 };
    const clash = this.pathOf(next);
    if (clash && clash !== path) return { ok: false, reason: 'exists' };

    const newPath = `${FOLDER}/${next}.md`;
    const changes: { path: string; after: string | null }[] = [
      { path, after: null },
      { path: newPath, after: this.files.read(path) ?? '' },
    ];
    for (const folder of ['tasks', 'archive', 'reference', 'daily', 'reviews']) {
      for (const rel of this.files.markdownFiles(folder, true)) {
        if (rel === path) continue;
        const text = this.files.read(rel) ?? '';
        const rewritten = rewriteLinks(text, old, next);
        if (rewritten !== text) changes.push({ path: rel, after: rewritten });
      }
    }
    // A note that links to itself: its new file gets the rewritten text too.
    changes[1]!.after = rewriteLinks(changes[1]!.after!, old, next);
    const undoId = this.files.apply(changes);
    return { ok: true, note: this.get(next)!, undoId, updated: changes.length - 2 };
  }

  /** Delete = move to .trash/reference/. Cards keep their link, which then shows as missing. */
  remove(name: string): { ok: true; undoId: string } | NoteError {
    const path = this.pathOf(name);
    if (!path) return { ok: false, reason: 'not-found' };
    const trash = this.files.freePath('.trash/reference', nameOf(path));
    const undoId = this.files.apply([
      { path, after: null },
      { path: trash, after: this.files.read(path) },
    ]);
    return { ok: true, undoId };
  }
}
