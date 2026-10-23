// Full-text search over the vault: cards (active and archived), reference notes,
// daily notes, and weekly reviews. An in-memory MiniSearch index, brought up to
// date before every query by re-reading only files whose size or time changed —
// so results are always current, even if a file-watch event was missed.
import { statSync } from 'node:fs';
import MiniSearch from 'minisearch';
import { type Status } from './cards.ts';
import { parseCard } from './cardFile.ts';
import { formatDay, isDate } from './daily.ts';
import type { VaultFiles } from './files.ts';
import { SEARCH_KINDS, type SearchHit, type SearchKind } from './searchTypes.ts';

export { SEARCH_KINDS, type SearchHit, type SearchKind };


interface Doc {
  id: string; // path in the vault
  kind: SearchKind;
  key: string; // card id, note name, date, or review name
  title: string;
  aliases: string; // extra words that should find it, e.g. a daily note's weekday and month
  text: string;
  status?: Status;
  archived?: boolean;
}

const SOURCES: { folder: string; kind: SearchKind; deep: boolean }[] = [
  { folder: 'tasks', kind: 'card', deep: false },
  { folder: 'archive', kind: 'card', deep: true },
  { folder: 'reference', kind: 'reference', deep: false },
  { folder: 'daily', kind: 'daily', deep: false },
  { folder: 'reviews', kind: 'review', deep: true },
  // A day's stickies are found as that day.
  { folder: 'stickies', kind: 'daily', deep: false },
];

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.md'.length);

function toDoc(path: string, kind: SearchKind, raw: string): Doc {
  if (kind === 'card') {
    try {
      const { card } = parseCard(raw);
      return {
        id: path,
        kind,
        key: card.id,
        title: card.title,
        aliases: card.refs.join(' ').replace(/[[\]]/g, ''),
        text: [card.notes, card.log].filter(Boolean).join('\n\n'),
        status: card.status,
        archived: path.startsWith('archive/'),
      };
    } catch {
      // A card file that can't be parsed is still searchable as plain text.
      return { id: path, kind, key: path, title: baseName(path), aliases: '', text: raw };
    }
  }
  const name = baseName(path);
  const aliases = kind === 'daily' && isDate(name) ? formatDay(name, 'dddd MMMM D YYYY') + (path.startsWith('stickies/') ? ' sticky stickies' : '') : '';
  return { id: path, kind, key: name, title: name, aliases, text: raw.replace(FRONTMATTER, '') };
}

/** A short excerpt around the first matching word, with markdown markers stripped. */
export function snippetOf(text: string, terms: string[], width = 180): string {
  const flat = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    // The start of a word, so "port" doesn't light up inside "report".
    const i = lower.search(new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.length > width ? `${flat.slice(0, width).replace(/\s\S*$/, '')}…` : flat;
  let start = Math.max(0, at - Math.floor(width / 3));
  if (start > 0) start = flat.indexOf(' ', start) + 1 || start;
  let end = Math.min(flat.length, start + width);
  const wordEnd = flat.lastIndexOf(' ', end);
  if (end < flat.length && wordEnd > at) end = wordEnd;
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export class SearchIndex {
  private mini = new MiniSearch<Doc>({
    fields: ['title', 'aliases', 'text'],
    storeFields: [],
  });
  private docs = new Map<string, Doc>();
  private signatures = new Map<string, string>();

  constructor(private readonly files: VaultFiles) {}

  /** Re-read changed files and drop deleted ones. Returns how many documents changed. */
  refresh(): number {
    let changed = 0;
    const present = new Set<string>();
    for (const { folder, kind, deep } of SOURCES) {
      for (const path of this.files.markdownFiles(folder, deep)) {
        present.add(path);
        let signature: string;
        try {
          const s = statSync(this.files.abs(path));
          signature = `${s.mtimeMs}:${s.size}`;
        } catch {
          continue; // removed while we were looking
        }
        if (this.signatures.get(path) === signature) continue;
        const raw = this.files.read(path);
        if (raw === null) continue;
        this.put(toDoc(path, kind, raw));
        this.signatures.set(path, signature);
        changed++;
      }
    }
    for (const path of [...this.docs.keys()]) {
      if (present.has(path)) continue;
      this.mini.discard(path);
      this.docs.delete(path);
      this.signatures.delete(path);
      changed++;
    }
    return changed;
  }

  private put(doc: Doc) {
    if (this.docs.has(doc.id)) this.mini.replace(doc);
    else this.mini.add(doc);
    this.docs.set(doc.id, doc);
  }

  get size() {
    return this.docs.size;
  }

  /** Exact (and prefix) matches first, then typo-tolerant ones. */
  search(query: string, limit = 60): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    this.refresh();
    const base = { prefix: (term: string) => term.length >= 2, boost: { title: 3, aliases: 2 }, combineWith: 'AND' as const };
    const exact = this.mini.search(q, { ...base, fuzzy: false });
    const seen = new Set(exact.map((r) => r.id));
    const fuzzy = this.mini
      .search(q, { ...base, fuzzy: (term: string) => (term.length >= 4 ? 0.25 : false) })
      .filter((r) => !seen.has(r.id));
    return [...exact.map((r) => ({ r, exact: true })), ...fuzzy.map((r) => ({ r, exact: false }))].slice(0, limit).map(({ r, exact }) => {
      const doc = this.docs.get(r.id as string)!;
      return {
        kind: doc.kind,
        key: doc.key,
        title: doc.title,
        path: doc.id,
        snippet: snippetOf(doc.text, r.terms),
        terms: r.terms,
        exact,
        ...(doc.kind === 'card' ? { status: doc.status, archived: doc.archived } : {}),
      };
    });
  }
}
