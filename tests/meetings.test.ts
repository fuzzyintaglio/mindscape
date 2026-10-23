import { describe, expect, it } from 'vitest';
import { addMeeting, currentOrNext, deleteMeeting, meetingsRange, parseMeetings, updateMeeting } from '../core/meetings.ts';
import { parseStickies, serializeStickies } from '../core/stickies.ts';

const NOTE = `## Capture
- 08:52 check the export

## Meetings
- 09:00–09:30 Team standup
    - Alpha launch slipping a week
        - QA needs two more days
- 10:30-11:30 Roadmap review
- a plain bullet, not a meeting

## Notes
Heads-down afternoon.
`;

describe('meetings in the daily note', () => {
  it('reads timed bullets in the Meetings section, with their nested notes', () => {
    expect(parseMeetings(NOTE)).toEqual([
      { start: 540, end: 570, title: 'Team standup', notes: '- Alpha launch slipping a week\n    - QA needs two more days' },
      { start: 630, end: 690, title: 'Roadmap review', notes: '' },
    ]);
    expect(parseMeetings('## Notes\n- 09:00–10:00 not in Meetings\n')).toEqual([]);
  });

  it('adds a meeting in time order, and creates the section when it is missing', () => {
    const added = addMeeting(NOTE, { start: 600, end: 630, title: '1:1' });
    expect(added).toContain('    - QA needs two more days\n- 10:00–10:30 1:1\n- 10:30-11:30 Roadmap review');
    const late = addMeeting(NOTE, { start: 900, end: 960, title: 'Critique' });
    expect(late).toContain('- a plain bullet, not a meeting\n- 15:00–16:00 Critique\n\n## Notes');
    expect(addMeeting('## Capture\n\n## Notes\n', { start: 540, end: 570, title: 'Sync' })).toBe('## Capture\n\n## Meetings\n- 09:00–09:30 Sync\n\n## Notes\n');
    expect(addMeeting('', { start: 540, end: 570, title: 'Sync' })).toBe('\n## Meetings\n- 09:00–09:30 Sync\n');
  });

  it('reschedules (moving the lines to keep time order), edits notes, and deletes', () => {
    const moved = updateMeeting(NOTE, 0, { start: 720, end: 750 });
    expect(parseMeetings(moved).map((m) => [m.title, m.start])).toEqual([['Roadmap review', 630], ['Team standup', 720]]);
    expect(parseMeetings(moved)[1]!.notes).toBe('- Alpha launch slipping a week\n    - QA needs two more days');
    const noted = updateMeeting(NOTE, 1, { notes: '- agreed three themes\n    - reliability first', title: 'Roadmap review with leads' });
    expect(noted).toContain('- 10:30–11:30 Roadmap review with leads\n    - agreed three themes\n        - reliability first\n- a plain bullet');
    expect(parseMeetings(deleteMeeting(NOTE, 0)).map((m) => m.title)).toEqual(['Roadmap review']);
    expect(deleteMeeting(NOTE, 0)).toContain('## Meetings\n- 10:30-11:30 Roadmap review');
  });

  it('knows what is happening now or next', () => {
    const meetings = parseMeetings(NOTE);
    expect(currentOrNext(meetings, 545)).toBe(0);
    expect(currentOrNext(meetings, 600)).toBe(1);
    expect(currentOrNext(meetings, 700)).toBeNull();
  });

  it('finds the section body for folding', () => {
    const r = meetingsRange(NOTE)!;
    expect(NOTE.slice(r.from, r.to)).toBe('\n- 09:00–09:30 Team standup\n    - Alpha launch slipping a week\n        - QA needs two more days\n- 10:30-11:30 Roadmap review\n- a plain bullet, not a meeting');
    expect(meetingsRange('## Meetings\n\n## Notes\n')).toBeNull();
  });
});

describe('stickies', () => {
  it('round-trips, drops empty ones, and keeps a stray --- from splitting a sticky', () => {
    const text = serializeStickies(['Room code 4471', '', '221 Market St\n3rd floor', 'a\n---\nb']);
    expect(text).toBe('Room code 4471\n\n---\n\n221 Market St\n3rd floor\n\n---\n\na\n—\nb\n');
    expect(parseStickies(text)).toEqual(['Room code 4471', '221 Market St\n3rd floor', 'a\n—\nb']);
    expect(parseStickies('')).toEqual([]);
  });
});
