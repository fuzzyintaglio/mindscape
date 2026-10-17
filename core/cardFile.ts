// Reading and writing a card's markdown file: YAML frontmatter + "## Notes" + "## Log".
// Fields this version doesn't know about are kept as-is when saving.
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { type Card, type HistoryEntry, isEffort, isStatus } from './cards.ts';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Known fields, in the order they're written.
const KEY_ORDER = [
  'id', 'title', 'status', 'effort', 'refs', 'created', 'updated', 'enteredColumn',
  'completed', 'archived', 'blockedBy', 'unblockBy', 'statusHistory',
] as const;

export interface ParsedFile {
  data: Record<string, unknown>;
  body: string;
}

export function splitFrontmatter(text: string): ParsedFile {
  const m = FRONTMATTER.exec(text);
  if (!m) return { data: {}, body: text };
  const data = YAML.parse(m[1] ?? '') ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter is not a set of fields');
  return { data: data as Record<string, unknown>, body: m[2] ?? '' };
}

/** Split the body into the user's Notes and the app-managed Log (the last "## Log" heading). */
export function splitBody(body: string): { notes: string; log: string } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let logAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^##\s+Log\s*$/.test(lines[i] ?? '')) {
      logAt = i;
      break;
    }
  }
  const notesLines = logAt >= 0 ? lines.slice(0, logAt) : lines;
  const logLines = logAt >= 0 ? lines.slice(logAt + 1) : [];
  const firstContent = notesLines.findIndex((l) => l.trim() !== '');
  if (firstContent >= 0 && /^##\s+Notes\s*$/.test(notesLines[firstContent] ?? '')) notesLines.splice(firstContent, 1);
  return { notes: notesLines.join('\n').trim(), log: logLines.join('\n').trim() };
}

export function joinBody(notes: string, log: string): string {
  let body = `## Notes\n${notes.trim() ? notes.trim() + '\n' : ''}`;
  if (log.trim()) body += `\n## Log\n${log.trim()}\n`;
  return body;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** Parse a card file. Throws with a readable message if it isn't a valid card. */
export function parseCard(text: string): { card: Card; extra: Record<string, unknown> } {
  const { data, body } = splitFrontmatter(text);
  const id = str(data.id);
  const title = str(data.title);
  if (!id) throw new Error('Missing "id" field');
  if (!title) throw new Error('Missing "title" field');
  if (!isStatus(data.status)) throw new Error(`Unknown status "${String(data.status)}"`);
  const effort = data.effort ?? 'medium';
  if (!isEffort(effort)) throw new Error(`Unknown effort "${String(effort)}"`);

  const history: HistoryEntry[] = Array.isArray(data.statusHistory)
    ? data.statusHistory
        .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object' && isStatus((h as Record<string, unknown>).status))
        .map((h) => {
          const entry: HistoryEntry = { status: h.status as HistoryEntry['status'], at: str(h.at) ?? '' };
          if (str(h.blockedBy)) entry.blockedBy = str(h.blockedBy)!;
          if (str(h.unblockBy)) entry.unblockBy = str(h.unblockBy)!;
          return entry;
        })
    : [];

  const created = str(data.created) ?? '';
  const { notes, log } = splitBody(body);
  const card: Card = {
    id,
    title,
    status: data.status,
    effort,
    refs: Array.isArray(data.refs) ? data.refs.map(String) : [],
    created,
    updated: str(data.updated) ?? created,
    enteredColumn: str(data.enteredColumn) ?? str(data.updated) ?? created,
    completed: str(data.completed),
    archived: str(data.archived),
    blockedBy: str(data.blockedBy),
    unblockBy: str(data.unblockBy),
    statusHistory: history,
    notes,
    log,
  };

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!(KEY_ORDER as readonly string[]).includes(k)) extra[k] = v;
  return { card, extra };
}

/** Write a card back to markdown. `extra` holds unknown fields from the original file. */
export function serializeCard(card: Card, extra: Record<string, unknown> = {}): string {
  const data: Record<string, unknown> = {
    id: card.id,
    title: card.title,
    status: card.status,
    effort: card.effort,
    refs: card.refs,
    created: card.created,
    updated: card.updated,
    enteredColumn: card.enteredColumn,
    completed: card.completed,
    archived: card.archived,
    blockedBy: card.blockedBy,
    unblockBy: card.unblockBy,
    statusHistory: card.statusHistory,
    ...extra,
  };
  const doc = new YAML.Document(data);
  // One line per history entry, like the plan's example.
  const history = doc.get('statusHistory', true);
  if (YAML.isSeq(history)) for (const item of history.items) if (YAML.isMap(item)) item.flow = true;
  const refs = doc.get('refs', true);
  if (YAML.isSeq(refs)) refs.flow = true;
  const yaml = doc.toString({ nullStr: '', lineWidth: 0 });
  return `---\n${yaml}---\n${joinBody(card.notes, card.log)}`;
}

export function revOf(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}
