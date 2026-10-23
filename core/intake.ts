// Intake: Claude reads daily notes and proposes changes; the app applies the ones
// you accept. Claude never edits cards or notes itself.
//
//   mindscape intake pending  → the lines Claude hasn't seen yet (and remembers what it showed)
//   Claude writes intake/draft.json
//   mindscape intake submit   → checks the draft, saves it as intake/<run>.json, marks those lines seen
//   the Intake screen         → accept / edit / reject; accepted ones are applied here
//
// "Seen" is tracked per line in .mindscape/intake-state.json, so a re-run never
// re-proposes a line, and a rejected proposal can't come back.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { EFFORTS, type StoredCard, isEffort } from './cards.ts';
import { dailyPath, formatDay, isDate } from './daily.ts';
import type { VaultFiles } from './files.ts';
import {
  PROPOSAL_TYPES,
  type Proposal,
  type ProposalEdits,
  type ProposalType,
  type ReviewItem,
  type StoredProposal,
} from './intakeTypes.ts';
import { cleanNoteName, refName, sameName } from './links.ts';
import type { NoteStore } from './notes.ts';
import type { CardStore } from './store.ts';
import { toLocalDate, toLocalIso } from './time.ts';

export * from './intakeTypes.ts';

export const STATE_PATH = '.mindscape/intake-state.json';
export const SNAPSHOT_PATH = 'intake/.pending.json';
export const DRAFT_PATH = 'intake/draft.json';

interface IntakeState {
  notes: Record<string, { seen: string[]; lastRun: string }>;
}

export interface PendingLine {
  hash: string;
  text: string;
  heading: string;
}

export interface PendingNote {
  date: string;
  path: string;
  lines: PendingLine[];
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

export function lineHash(line: string): string {
  return createHash('sha1').update(normalize(line)).digest('hex').slice(0, 12);
}

/** The lines of a daily note worth reading: not blank, not headings, not rules. */
export function noteLines(text: string): PendingLine[] {
  const out: PendingLine[] = [];
  let heading = '';
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1]!.trim();
      continue;
    }
    if (!line.trim() || /^(-{3,}|\*{3,}|`{3,}.*)$/.test(line.trim())) continue;
    out.push({ hash: lineHash(line), text: line, heading });
  }
  return out;
}

function readJson<T>(files: VaultFiles, path: string, fallback: T): T {
  const text = files.read(path);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const writeJson = (files: VaultFiles, path: string, data: unknown) => files.write(path, `${JSON.stringify(data, null, 2)}\n`);

function loadState(files: VaultFiles): IntakeState {
  const state = readJson<IntakeState>(files, STATE_PATH, { notes: {} });
  return state && typeof state.notes === 'object' ? state : { notes: {} };
}

/** Daily notes before today (and today, if asked) that have lines Claude hasn't seen yet. */
export function pendingNotes(files: VaultFiles, opts: { includeToday?: boolean; today?: string } = {}): PendingNote[] {
  const today = opts.today ?? toLocalDate();
  const state = loadState(files);
  const out: PendingNote[] = [];
  for (const path of files.markdownFiles('daily')) {
    const date = path.slice('daily/'.length, -'.md'.length);
    if (!isDate(date) || date > today || (date === today && !opts.includeToday)) continue;
    const seen = new Set(state.notes[date]?.seen ?? []);
    const lines = noteLines(files.read(path) ?? '').filter((l) => !seen.has(l.hash));
    if (lines.length) out.push({ date, path, lines });
  }
  return out;
}

/** List what's pending and remember exactly what was shown, so submit marks those lines seen. */
export function preparePending(files: VaultFiles, opts: { includeToday?: boolean; today?: string } = {}): PendingNote[] {
  const notes = pendingNotes(files, opts);
  writeJson(files, SNAPSHOT_PATH, { created: toLocalIso(), notes: Object.fromEntries(notes.map((n) => [n.date, n.lines.map((l) => l.hash)])) });
  return notes;
}

/** The pending lines as readable markdown, grouped by day and heading. */
export function formatPending(notes: PendingNote[], vault: string): string {
  if (!notes.length) return 'Nothing new to process.';
  const parts: string[] = [];
  for (const note of notes) {
    parts.push(`## ${note.date} (${formatDay(note.date, 'dddd')}) — ${vault}/${note.path}`);
    let heading: string | null = null;
    for (const line of note.lines) {
      if (line.heading !== heading) {
        heading = line.heading;
        if (heading) parts.push(`### ${heading}`);
      }
      parts.push(line.text);
    }
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

// ── Checking a draft ─────────────────────────────────────────

export interface DraftContext {
  files: VaultFiles;
  cards: StoredCard[];
  noteNames: string[];
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Is `quote` (ignoring spacing) part of that day's note? */
function quoteFound(files: VaultFiles, date: string, quote: string): boolean {
  const note = files.read(dailyPath(date));
  return note !== null && normalize(note).includes(normalize(quote));
}

/**
 * Check a draft written by Claude. Every problem is reported with the proposal's
 * number, so it can be fixed and submitted again.
 */
export function validateDraft(raw: unknown, ctx: DraftContext): { proposals: Proposal[]; errors: string[] } {
  const errors: string[] = [];
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { proposals?: unknown }).proposals : undefined;
  if (!Array.isArray(list)) return { proposals: [], errors: ['The draft must be a JSON object with a "proposals" list (it can be empty).'] };

  const cardIds = new Set(ctx.cards.map((c) => c.id));
  const newNotes = list
    .filter((p): p is { type: 'new-note'; name: string } => !!p && (p as { type?: unknown }).type === 'new-note' && isText((p as { name?: unknown }).name))
    .map((p) => cleanNoteName(p.name));
  const noteExists = (name: string) => ctx.noteNames.some((n) => sameName(n, name));
  const proposals: Proposal[] = [];

  list.forEach((item: unknown, i: number) => {
    const at = `Proposal ${i + 1}`;
    const fail = (msg: string) => errors.push(`${at}: ${msg}`);
    if (!item || typeof item !== 'object') return fail('must be an object.');
    const p = item as Record<string, unknown>;
    if (!PROPOSAL_TYPES.includes(p.type as ProposalType)) return fail(`"type" must be one of ${PROPOSAL_TYPES.join(', ')}.`);
    const source = p.source as Record<string, unknown> | undefined;
    if (!source || !isText(source.date) || !isDate(source.date)) return fail('"source.date" must be a daily note date, YYYY-MM-DD.');
    if (!isText(source.quote)) return fail('"source.quote" is required: the line from the daily note, copied word for word.');
    if (!ctx.files.exists(dailyPath(source.date))) return fail(`there is no daily note for ${source.date}.`);
    if (!quoteFound(ctx.files, source.date, source.quote)) return fail(`"source.quote" isn't in the ${source.date} note word for word: ${JSON.stringify(source.quote)}`);
    const base = { source: { date: source.date, quote: source.quote.trim() }, ...(isText(p.why) ? { why: p.why.trim() } : {}) };

    if (p.type === 'new-task') {
      if (!isText(p.title)) return fail('"title" is required.');
      if (!isEffort(p.effort)) return fail(`"effort" must be one of ${EFFORTS.join(', ')}.`);
      const refs = p.refs ?? [];
      if (!textList(refs)) return fail('"refs" must be a list of reference-note names.');
      const unknown = refs.map(refName).filter((r) => !noteExists(r) && !newNotes.some((n) => sameName(n, r)));
      if (unknown.length) return fail(`"refs" names notes that don't exist and aren't proposed in this draft: ${unknown.join(', ')}.`);
      if (p.due !== undefined && p.due !== null && !(isText(p.due) && isDate(p.due))) return fail('"due" must be a date, YYYY-MM-DD (or leave it out).');
      proposals.push({ type: 'new-task', title: p.title.trim(), effort: p.effort, refs: refs.map(refName), ...(isText(p.due) ? { due: p.due } : {}), ...base });
    } else if (p.type === 'card-log') {
      if (!isText(p.cardId) || !cardIds.has(p.cardId)) return fail(`"cardId" must be the id of a card on the board (from mindscape index), got ${JSON.stringify(p.cardId)}.`);
      if (!isText(p.text)) return fail('"text" is required.');
      proposals.push({ type: 'card-log', cardId: p.cardId, text: p.text.trim(), ...base });
    } else if (p.type === 'new-note') {
      if (!isText(p.name) || !cleanNoteName(p.name)) return fail('"name" is required.');
      if (noteExists(cleanNoteName(p.name))) return fail(`a note named "${p.name}" already exists; use "note-append" instead.`);
      if (!isText(p.text)) return fail('"text" is required.');
      const linkCards = p.linkCards ?? [];
      if (!textList(linkCards) || linkCards.some((id) => !cardIds.has(id))) return fail('"linkCards" must be a list of card ids from mindscape index.');
      proposals.push({ type: 'new-note', name: cleanNoteName(p.name), text: p.text.trim(), linkCards, ...base });
    } else {
      if (!isText(p.note) || !noteExists(refName(p.note))) return fail(`"note" must be the name of an existing reference note, got ${JSON.stringify(p.note)}.`);
      if (!isText(p.text)) return fail('"text" is required.');
      proposals.push({ type: 'note-append', note: refName(p.note), text: p.text.trim(), ...base });
    }
  });
  return { proposals, errors };
}

/** A run id that sorts by time, e.g. 2026-10-18-091512. */
export function runIdFor(now: Date): string {
  return toLocalIso(now).slice(0, 19).replace('T', '-').replace(/:/g, '');
}

export interface SubmitResult {
  ok: boolean;
  errors: string[];
  runId: string | null;
  proposals: number;
  notesMarked: number;
}

/**
 * Check intake/draft.json; if it's good, save it as intake/<run>.json for review,
 * mark every line from the last `pending` as seen, and remove the draft.
 */
export function submitDraft(files: VaultFiles, cards: CardStore, notes: NoteStore, now: Date = new Date()): SubmitResult {
  const empty = { runId: null, proposals: 0, notesMarked: 0 };
  const text = files.read(DRAFT_PATH);
  if (text === null) return { ok: false, errors: [`No draft found at ${DRAFT_PATH}.`], ...empty };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`The draft isn't valid JSON: ${(err as Error).message}`], ...empty };
  }
  const { proposals, errors } = validateDraft(raw, { files, cards: cards.list().cards, noteNames: notes.list().map((n) => n.name) });
  if (errors.length) return { ok: false, errors, ...empty };

  let runId: string | null = null;
  if (proposals.length) {
    runId = runIdFor(now);
    while (files.exists(`intake/${runId}.json`)) runId = `${runId}-2`;
    const stored: StoredProposal[] = proposals.map((p, i) => ({ ...p, id: `p${i + 1}`, status: 'pending' }));
    writeJson(files, `intake/${runId}.json`, { id: runId, created: toLocalIso(now), proposals: stored });
  }

  const snapshot = readJson<{ notes?: Record<string, string[]> }>(files, SNAPSHOT_PATH, {});
  const state = loadState(files);
  const shown = Object.entries(snapshot.notes ?? {});
  for (const [date, hashes] of shown) {
    const seen = new Set([...(state.notes[date]?.seen ?? []), ...hashes]);
    state.notes[date] = { seen: [...seen], lastRun: toLocalIso(now) };
  }
  writeJson(files, STATE_PATH, state);
  files.write(SNAPSHOT_PATH, null);
  files.write(DRAFT_PATH, null);
  return { ok: true, errors: [], runId, proposals: proposals.length, notesMarked: shown.length };
}

// ── Reviewing and applying ───────────────────────────────────

interface RunFile {
  id: string;
  created: string;
  proposals: StoredProposal[];
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

const sourceHeading = (date: string) => `### ${date} (from [[${date}]])`;
const logLine = (date: string, text: string) => `- ${date} — "${normalize(text).replace(/"/g, '”')}" ([[${date}]])`;
/** "- 09:41 call the vendor" → "call the vendor" */
const quoteText = (quote: string) => quote.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '').replace(/^\d{1,2}:\d{2}\s+/, '').trim();

// Notes first, so tasks accepted in the same batch can link to them.
const APPLY_ORDER: ProposalType[] = ['new-note', 'note-append', 'new-task', 'card-log'];

export class IntakeReview {
  constructor(
    private readonly files: VaultFiles,
    private readonly cards: CardStore,
    private readonly notes: NoteStore,
  ) {}

  private runIds(): string[] {
    const dir = this.files.abs('intake');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.') && `intake/${f}` !== DRAFT_PATH)
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  }

  private loadRun(runId: string): RunFile | null {
    const run = readJson<RunFile | null>(this.files, `intake/${runId}.json`, null);
    return run && Array.isArray(run.proposals) ? run : null;
  }

  /** Why a proposal can't be applied right now, if anything. */
  private check(p: Proposal): { stale?: string; warning?: string; cardTitle?: string } {
    const noteExists = (name: string) => !!this.notes.get(name);
    if (p.type === 'card-log') {
      const card = this.cards.get(p.cardId);
      return card ? { cardTitle: card.title } : { stale: 'Its card is no longer on the board. Pick another card or reject it.' };
    }
    if (p.type === 'note-append') return noteExists(p.note) ? {} : { stale: `There's no note named “${p.note}” any more. Pick another note or reject it.` };
    if (p.type === 'new-note') return noteExists(p.name) ? { stale: `A note named “${p.name}” already exists. Rename it or reject it.` } : {};
    const missing = p.refs.filter((r) => !noteExists(r));
    return missing.length ? { warning: `Links to ${missing.map((m) => `“${m}”`).join(', ')}, which doesn't exist yet.` } : {};
  }

  list(): ReviewItem[] {
    const items: ReviewItem[] = [];
    for (const runId of this.runIds()) {
      for (const proposal of this.loadRun(runId)?.proposals ?? []) {
        if (proposal.status === 'pending') items.push({ runId, proposal, ...this.check(proposal) });
      }
    }
    return items;
  }

  pendingCount(): number {
    return this.list().length;
  }

  /** Accept or reject proposals. Everything it changes is one undoable step. */
  decide(decisions: Decision[]): DecideResult {
    const runs = new Map<string, RunFile>();
    const undoIds: string[] = [];
    const results: DecideResult['results'] = [];
    const counts = { cards: 0, logs: 0, notes: 0, appends: 0, rejected: 0 };
    const now = toLocalIso();

    const ordered = [...decisions].sort((a, b) => {
      const type = (d: Decision) => this.loadRun(d.runId)?.proposals.find((p) => p.id === d.id)?.type ?? 'card-log';
      return APPLY_ORDER.indexOf(type(a)) - APPLY_ORDER.indexOf(type(b));
    });

    for (const d of ordered) {
      const fail = (error: string) => results.push({ runId: d.runId, id: d.id, ok: false, error });
      if (!runs.has(d.runId)) {
        const run = this.loadRun(d.runId);
        if (run) runs.set(d.runId, run);
      }
      const run = runs.get(d.runId);
      const index = run?.proposals.findIndex((p) => p.id === d.id) ?? -1;
      if (!run || index < 0) {
        fail('That proposal no longer exists.');
        continue;
      }
      const stored = run.proposals[index]!;
      if (stored.status !== 'pending') {
        fail('That proposal was already decided.');
        continue;
      }
      if (d.action === 'reject') {
        run.proposals[index] = { ...stored, status: 'rejected', decided: now };
        counts.rejected++;
        results.push({ runId: d.runId, id: d.id, ok: true });
        continue;
      }

      const edited = applyEdits(stored, d.edits ?? {});
      if (typeof edited === 'string') {
        fail(edited);
        continue;
      }
      const { stale } = this.check(edited);
      if (stale) {
        fail(stale);
        continue;
      }
      const applied = this.apply(edited);
      if (typeof applied === 'string') {
        fail(applied);
        continue;
      }
      undoIds.push(...applied.undoIds);
      run.proposals[index] = { ...edited, id: stored.id, status: 'accepted', decided: now, result: applied.result };
      counts[applied.kind]++;
      results.push({ runId: d.runId, id: d.id, ok: true });
    }

    // Saving the decisions is part of the same undo, so Undo puts proposals back as pending.
    if (runs.size) undoIds.push(this.files.apply([...runs.values()].map((run) => ({ path: `intake/${run.id}.json`, after: `${JSON.stringify(run, null, 2)}\n` }))));
    return { results, summary: summarize(counts), undoId: undoIds.length ? this.files.merge(undoIds) : null };
  }

  private apply(p: Proposal): { kind: 'cards' | 'logs' | 'notes' | 'appends'; result: string; undoIds: string[] } | string {
    const { date, quote } = p.source;
    if (p.type === 'new-task') {
      const created = this.cards.create({ title: p.title, effort: p.effort, due: p.due ?? null });
      const undoIds = [created.undoId];
      if (p.refs.length) {
        const linked = this.cards.update(created.card.id, { refs: p.refs });
        if (linked.ok && linked.undoId) undoIds.push(linked.undoId);
      }
      const logged = this.cards.appendLog(created.card.id, logLine(date, quoteText(quote)));
      if (logged.ok) undoIds.push(logged.undoId);
      return { kind: 'cards', result: created.card.id, undoIds };
    }
    if (p.type === 'card-log') {
      const logged = this.cards.appendLog(p.cardId, logLine(date, p.text));
      return logged.ok ? { kind: 'logs', result: p.cardId, undoIds: [logged.undoId] } : 'Its card is no longer on the board.';
    }
    if (p.type === 'new-note') {
      const created = this.notes.create(p.name, `${sourceHeading(date)}\n${p.text}\n`);
      if (!created.ok) return `Couldn't create “${p.name}” (${created.reason}).`;
      const undoIds = [created.undoId];
      for (const id of p.linkCards) {
        const card = this.cards.get(id);
        if (!card) continue;
        const linked = this.cards.update(id, { refs: [...card.refs, created.note.name] });
        if (linked.ok && linked.undoId) undoIds.push(linked.undoId);
      }
      return { kind: 'notes', result: created.note.name, undoIds };
    }
    const appended = this.notes.append(p.note, `${sourceHeading(date)}\n${p.text}`);
    return appended.ok ? { kind: 'appends', result: appended.note.name, undoIds: [appended.undoId] } : `There's no note named “${p.note}”.`;
  }
}

/** Apply the reviewer's edits, checking them; returns an error message if they don't make sense. */
function applyEdits(p: StoredProposal, e: ProposalEdits): StoredProposal | string {
  const blank = (v: string | undefined) => v !== undefined && !v.trim();
  if (blank(e.title)) return "The title can't be empty.";
  if (blank(e.text)) return "The text can't be empty.";
  if (e.effort !== undefined && !isEffort(e.effort)) return 'Unknown effort.';
  if (e.due && !isDate(e.due)) return 'The due date must be YYYY-MM-DD.';
  const or = (v: string | undefined, fallback: string) => (v === undefined ? fallback : v.trim());
  if (p.type === 'new-task') {
    return { ...p, title: or(e.title, p.title), effort: e.effort ?? p.effort, refs: (e.refs ?? p.refs).map(refName).filter(Boolean), due: e.due === undefined ? (p.due ?? null) : e.due || null };
  }
  if (p.type === 'card-log') return { ...p, cardId: or(e.cardId, p.cardId), text: or(e.text, p.text) };
  if (p.type === 'new-note') {
    const name = e.name === undefined ? p.name : cleanNoteName(e.name);
    if (!name) return 'The note needs a name.';
    return { ...p, name, text: or(e.text, p.text), linkCards: e.linkCards ?? p.linkCards };
  }
  return { ...p, note: or(e.note, p.note), text: or(e.text, p.text) };
}

function summarize(c: { cards: number; logs: number; notes: number; appends: number; rejected: number }): string {
  const n = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : '');
  const parts = [
    n(c.cards, 'card created', 'cards created'),
    n(c.logs, 'card log entry added', 'card log entries added'),
    n(c.notes, 'note created', 'notes created'),
    n(c.appends, 'note updated', 'notes updated'),
    n(c.rejected, 'rejected', 'rejected'),
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.`.replace(/^./, (ch) => ch.toUpperCase()) : 'Nothing changed.';
}
