// Safe file access for the vault. Writes are atomic (temp file + rename), and
// grouped changes are journaled so Undo restores files exactly — for cards and
// reference notes alike.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { newId } from './cards.ts';

interface FileOp {
  path: string; // relative to the vault
  before: string | null; // null = file didn't exist
  after: string | null; // null = file removed
}

const UNDO_LIMIT = 50;

export class VaultFiles {
  private undos = new Map<string, FileOp[]>();

  constructor(readonly vault: string) {}

  abs(rel: string) {
    return join(this.vault, rel);
  }

  exists(rel: string) {
    return existsSync(this.abs(rel));
  }

  read(rel: string): string | null {
    const p = this.abs(rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }

  modified(rel: string): string {
    return statSync(this.abs(rel)).mtime.toISOString();
  }

  /** Write via a temp file + rename, so a crash never leaves a half-written file. */
  write(rel: string, text: string | null) {
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

  /** Markdown files directly inside `folder` (or in its subfolders too, with `deep`). */
  markdownFiles(folder: string, deep = false): string[] {
    return this.filesIn(folder, '.md', deep);
  }

  /** Files ending in `ext` directly inside `folder` (or in its subfolders too, with `deep`). */
  filesIn(folder: string, ext: string, deep = false): string[] {
    const out: string[] = [];
    const walk = (rel: string) => {
      const dir = this.abs(rel);
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory() && deep) walk(`${rel}/${e.name}`);
        else if (e.isFile() && e.name.endsWith(ext)) out.push(`${rel}/${e.name}`);
      }
    };
    walk(folder);
    return out.sort();
  }

  /** Apply file changes together and remember how to undo them. */
  apply(changes: { path: string; after: string | null }[]): string {
    const ops: FileOp[] = changes.map((c) => ({ path: c.path, before: this.read(c.path), after: c.after }));
    for (const op of ops) this.write(op.path, op.after);
    const undoId = newId();
    this.undos.set(undoId, ops);
    while (this.undos.size > UNDO_LIMIT) this.undos.delete(this.undos.keys().next().value!);
    return undoId;
  }

  /**
   * Combine several journaled changes into one undo entry (e.g. accepting a batch
   * of proposals). Each file keeps its first "before" and last "after".
   */
  merge(undoIds: string[]): string {
    const byPath = new Map<string, FileOp>();
    for (const id of undoIds) {
      for (const op of this.undos.get(id) ?? []) {
        const prev = byPath.get(op.path);
        byPath.set(op.path, { path: op.path, before: prev ? prev.before : op.before, after: op.after });
      }
      this.undos.delete(id);
    }
    const undoId = newId();
    this.undos.set(undoId, [...byPath.values()]);
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

  /** A free path like folder/name.md, folder/name-2.md, … (`keep` may be reused). Case-insensitive, like macOS. */
  freePath(folder: string, base: string, keep?: string): string {
    const taken = new Set(this.markdownFiles(folder).map((p) => p.toLowerCase()));
    for (let n = 1; ; n++) {
      const rel = `${folder}/${n === 1 ? base : `${base}-${n}`}.md`;
      if (rel === keep || !taken.has(rel.toLowerCase())) return rel;
    }
  }
}
