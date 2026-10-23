// Daily notes: daily/YYYY-MM-DD.md, created from templates/daily.md. The whole file
// belongs to the user — the app only ever creates it and appends captures.
import type { Effort } from './cards.ts';
import type { VaultFiles } from './files.ts';
import { DATE_NAME } from './links.ts';
import { toLocalDate } from './time.ts';

export const DAILY_TEMPLATE_PATH = 'templates/daily.md';

export const DEFAULT_DAILY_TEMPLATE = `## Capture

## Meetings

## Notes
`;

export const dailyPath = (date: string) => `daily/${date}.md`;

export const isDate = (s: string) => DATE_NAME.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The subset of Obsidian/moment date tokens templates are likely to use. */
export function formatDay(date: string, format: string): string {
  const d = new Date(`${date}T00:00:00`);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MMMM: MONTHS[d.getMonth()]!,
    MMM: MONTHS[d.getMonth()]!.slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    dddd: DAYS[d.getDay()]!,
    ddd: DAYS[d.getDay()]!.slice(0, 3),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
  };
  return format.replace(/YYYY|MMMM|MMM|MM|M|dddd|ddd|DD|D/g, (t) => tokens[t]!);
}

/** Fill in {{date}}, {{title}} (the note name, as in Obsidian), and {{date:FORMAT}}. */
export function renderTemplate(template: string, date: string): string {
  return template.replace(/\{\{\s*(date|title)(?::([^}]*))?\s*\}\}/g, (_m, key: string, format?: string) =>
    key === 'date' && format ? formatDay(date, format.trim()) : date,
  );
}

/** Create templates/daily.md if it's missing, so it can be edited. */
export function ensureDailyTemplate(files: VaultFiles): void {
  if (!files.exists(DAILY_TEMPLATE_PATH)) files.write(DAILY_TEMPLATE_PATH, DEFAULT_DAILY_TEMPLATE);
}

/** The daily note's text, creating it from the template first if it doesn't exist. Never overwrites. */
export function ensureDaily(files: VaultFiles, date: string = toLocalDate()): { text: string; created: boolean } {
  const existing = files.read(dailyPath(date));
  if (existing !== null) return { text: existing, created: false };
  const template = files.read(DAILY_TEMPLATE_PATH) ?? DEFAULT_DAILY_TEMPLATE;
  const text = renderTemplate(template, date);
  files.write(dailyPath(date), text);
  return { text, created: true };
}

/** "- 09:41 call about timelines" */
export function captureLine(text: string, now: Date = new Date()): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `- ${hh}:${mm} ${text.replace(/\s+/g, ' ').trim()}`;
}

/**
 * Where a capture goes: the end of the "## Capture" section (after its last
 * non-blank line), or a new section at the end of the note if there isn't one.
 * Returned as an insertion, so an open editor can apply it without moving the cursor.
 */
export function captureInsertion(note: string, line: string): { at: number; insert: string } {
  const lines = note.split('\n');
  const offsets: number[] = [];
  let pos = 0;
  for (const l of lines) {
    offsets.push(pos);
    pos += l.length + 1;
  }
  const heading = lines.findIndex((l) => /^##\s+Capture\s*$/i.test(l));
  if (heading < 0) {
    const sep = note === '' ? '' : note.endsWith('\n\n') ? '' : note.endsWith('\n') ? '\n' : '\n\n';
    return { at: note.length, insert: `${sep}## Capture\n${line}\n` };
  }
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end++;
  let last = heading;
  for (let i = heading + 1; i < end; i++) if (lines[i]!.trim() !== '') last = i;
  const lineEnd = offsets[last]! + lines[last]!.length;
  // A note that ends right after the last line has no newline to put ours before.
  return { at: lineEnd, insert: `\n${line}` };
}

export function applyInsertion(note: string, { at, insert }: { at: number; insert: string }): string {
  return note.slice(0, at) + insert + note.slice(at);
}

/** Append a captured line to today's daily note (creating the note if needed). */
export function appendCapture(files: VaultFiles, text: string, now: Date = new Date()): { date: string; line: string } {
  const date = toLocalDate(now);
  const { text: note } = ensureDaily(files, date);
  const line = captureLine(text, now);
  files.write(dailyPath(date), applyInsertion(note, captureInsertion(note, line)));
  return { date, line };
}

export interface CaptureTask {
  title: string;
  effort: Effort;
  /** From a trailing @date, e.g. `@fri`. */
  due?: string;
}

const CAPTURE_EFFORT: Record<string, Effort> = { '!': 'high', ':': 'medium', '-': 'low' };

/**
 * `t: Call the vendor` → a Medium card; `t! …` → High; `t- …` → Low. Anything else → null
 * (goes to the daily note). `t!` and `t-` need a space or colon after them, so a capture
 * like "t-shirt order" stays a note. A date at the end (`@fri`, `@10/30`) becomes the due date.
 */
export function taskFromCapture(text: string, today: string = toLocalDate()): CaptureTask | null {
  const m = /^\s*t(?::|([!-])(?::|\s))(.*)$/is.exec(text);
  if (!m) return null;
  let title = m[2]!.replace(/\s+/g, ' ').trim();
  const effort = CAPTURE_EFFORT[m[1] ?? ':']!;
  const at = /\s@(\S+)$/.exec(title);
  const due = at ? dueFromToken(at[1]!, today) : null;
  if (due) title = title.slice(0, at!.index).trim();
  if (!title) return null;
  return due ? { title, effort, due } : { title, effort };
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * `today`, `tomorrow`, a weekday (`mon`…`sun`, or spelled out: the next one after today),
 * `10/30` (this year, or next year if it has passed), `10/30/27`, or `2026-10-30`.
 * Anything else → null, so `@alice` stays in the title.
 */
export function dueFromToken(token: string, today: string = toLocalDate()): string | null {
  const t = token.toLowerCase().replace(/[.,;!?]+$/, '');
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const day = (offset: number) => toLocalDate(new Date(y, m - 1, d + offset, 12));
  const valid = (yy: number, mm: number, dd: number) => {
    const date = new Date(yy, mm - 1, dd, 12);
    return date.getFullYear() === yy && date.getMonth() === mm - 1 && date.getDate() === dd ? toLocalDate(date) : null;
  };
  if (t === 'today') return today;
  if (t === 'tomorrow' || t === 'tmrw') return day(1);
  const weekday = WEEKDAYS.findIndex((w) => t === w || (t.length >= 3 && `${w}${{ sun: 'day', mon: 'day', tue: 'sday', wed: 'nesday', thu: 'rsday', fri: 'day', sat: 'urday' }[w]}`.startsWith(t)));
  if (weekday >= 0) {
    const ahead = (weekday - new Date(y, m - 1, d, 12).getDay() + 7) % 7 || 7;
    return day(ahead);
  }
  let parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (parts) return valid(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  parts = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  if (!parts) return null;
  const mm = Number(parts[1]);
  const dd = Number(parts[2]);
  if (parts[3]) return valid(parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3]), mm, dd);
  const thisYear = valid(y, mm, dd);
  if (!thisYear) return null;
  return thisYear >= today ? thisYear : valid(y + 1, mm, dd);
}
