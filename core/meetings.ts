// Meetings live in the daily note's "## Meetings" section as timed bullets:
//
//   - 09:00–09:30 Design review
//       - notes, nested under it
//
// The Today view's calendar reads and writes these lines; the note stays the only
// copy, so intake reads meetings like any other part of the note. Pure functions.

export interface Meeting {
  /** Minutes after midnight. */
  start: number;
  end: number;
  title: string;
  /** The nested lines, with one level of indentation removed (4 spaces per level after that). */
  notes: string;
}

const INDENT = '    ';
const MEETING_LINE = /^[-*+]\s+(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s+(.*)$/;
const HEADING = /^#{1,2}\s/;

/** "09:05" */
export const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Where the Meetings section's lines are: [first line after the heading, end), or null. */
function section(lines: string[]): { heading: number; from: number; to: number } | null {
  const heading = lines.findIndex((l) => /^##\s+Meetings\s*$/i.test(l));
  if (heading < 0) return null;
  let to = heading + 1;
  while (to < lines.length && !HEADING.test(lines[to]!)) to++;
  return { heading, from: heading + 1, to };
}

interface Block {
  meeting: Meeting;
  /** Lines [from, to) in the note: the bullet and everything nested under it. */
  from: number;
  to: number;
}

function blocks(lines: string[]): Block[] {
  const s = section(lines);
  if (!s) return [];
  const out: Block[] = [];
  for (let i = s.from; i < s.to; i++) {
    const m = MEETING_LINE.exec(lines[i]!);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    let j = i + 1;
    while (j < s.to && (/^\s+\S/.test(lines[j]!) || (lines[j]!.trim() === '' && j + 1 < s.to && /^\s+\S/.test(lines[j + 1]!)))) j++;
    const nested = lines.slice(i + 1, j);
    const indents = nested.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].replace(/\t/g, INDENT).length);
    const strip = indents.length ? Math.min(...indents) : 0;
    const notes = nested.map((l) => l.replace(/\t/g, INDENT).slice(strip)).join('\n').replace(/\s+$/, '');
    if (start < 24 * 60 && end <= 24 * 60 && end > start) out.push({ meeting: { start, end, title: m[5]!.trim(), notes }, from: i, to: j });
    i = j - 1;
  }
  return out;
}

/** The meetings in a note, in the order they're written. */
export function parseMeetings(note: string): Meeting[] {
  return blocks(note.split('\n')).map((b) => b.meeting);
}

function render(m: Meeting): string[] {
  const head = `- ${clock(m.start)}–${clock(m.end)} ${m.title.replace(/\s+/g, ' ').trim()}`;
  const notes = m.notes.replace(/\s+$/, '');
  return notes ? [head, ...notes.split('\n').map((l) => (l.trim() ? INDENT + l : ''))] : [head];
}

/** Put a meeting's lines in the section, after the meetings that start earlier. */
function insertSorted(lines: string[], m: Meeting): string[] {
  let s = section(lines);
  if (!s) {
    // No Meetings section: add one before "## Notes", or at the end.
    const notes = lines.findIndex((l) => /^##\s+Notes\s*$/i.test(l));
    const at = notes >= 0 ? notes : lines.length;
    const before = at > 0 && lines[at - 1]!.trim() !== '' ? [''] : [];
    lines = [...lines.slice(0, at), ...before, '## Meetings', '', ...lines.slice(at)];
    s = section(lines)!;
  }
  const later = blocks(lines).find((b) => b.meeting.start > m.start);
  let at: number;
  if (later) at = later.from;
  else {
    // After the last non-blank line of the section (or right under the heading).
    at = s.to;
    while (at > s.from && lines[at - 1]!.trim() === '') at--;
  }
  const out = [...lines.slice(0, at), ...render(m), ...lines.slice(at)];
  // Keep a blank line between the section and the next heading.
  const next = at + render(m).length;
  if (next < out.length && HEADING.test(out[next]!)) out.splice(next, 0, '');
  return out;
}

export function addMeeting(note: string, m: Pick<Meeting, 'start' | 'end' | 'title'> & { notes?: string }): string {
  return insertSorted(note.split('\n'), { notes: '', ...m }).join('\n');
}

/**
 * Change the `index`th meeting (in written order). A new start time moves it to keep
 * the section in time order; title and notes are edited in place.
 */
export function updateMeeting(note: string, index: number, patch: Partial<Meeting>): string {
  const lines = note.split('\n');
  const block = blocks(lines)[index];
  if (!block) return note;
  const next = { ...block.meeting, ...patch };
  const replaced = render(next);
  if (next.start === block.meeting.start) return [...lines.slice(0, block.from), ...replaced, ...lines.slice(block.to)].join('\n');
  const without = [...lines.slice(0, block.from), ...lines.slice(block.to)];
  return insertSorted(without, next).join('\n');
}

export function deleteMeeting(note: string, index: number): string {
  const lines = note.split('\n');
  const block = blocks(lines)[index];
  if (!block) return note;
  return [...lines.slice(0, block.from), ...lines.slice(block.to)].join('\n');
}

/** Where the Meetings section's body is, as character offsets (for folding it in the editor). */
export function meetingsRange(note: string): { from: number; to: number } | null {
  const lines = note.split('\n');
  const s = section(lines);
  if (!s) return null;
  let last = s.to;
  while (last > s.from && lines[last - 1]!.trim() === '') last--;
  if (last <= s.from) return null;
  const offset = (line: number) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  return { from: offset(s.heading) + lines[s.heading]!.length, to: offset(last - 1) + lines[last - 1]!.length };
}

/** The meeting happening at `minutes`, else the next one today, else null. Indexes into `meetings`. */
export function currentOrNext(meetings: Meeting[], minutes: number): number | null {
  const order = meetings.map((m, i) => ({ m, i })).sort((a, b) => a.m.start - b.m.start);
  const now = order.find(({ m }) => m.start <= minutes && m.end > minutes);
  if (now) return now.i;
  const next = order.find(({ m }) => m.start > minutes);
  return next ? next.i : null;
}

/** The meeting happening at `minutes`, or null. */
export function happeningAt(meetings: Meeting[], minutes: number): number | null {
  const i = meetings.findIndex((m) => m.start <= minutes && m.end > minutes);
  return i >= 0 ? i : null;
}
