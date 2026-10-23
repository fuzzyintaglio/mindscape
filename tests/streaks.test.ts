import { describe, expect, it } from 'vitest';
import { moveCard, newCard } from '../core/cards.ts';
import { noteActivity, progressDays, streakLength } from '../core/streaks.ts';

const set = (...days: string[]) => new Set(days);

describe('streaks', () => {
  const fri = '2026-10-23';
  it('counts weekdays in a row back from today, or from yesterday until today has something', () => {
    expect(streakLength(set('2026-10-21', '2026-10-22', fri), fri)).toBe(3);
    expect(streakLength(set('2026-10-21', '2026-10-22'), fri)).toBe(2); // today isn't over
    expect(streakLength(set('2026-10-20', '2026-10-22'), fri)).toBe(1); // Wednesday broke it
    expect(streakLength(set(), fri)).toBe(0);
  });

  it('skips weekends without breaking, and counts weekend activity', () => {
    const mon = '2026-10-26';
    expect(streakLength(set('2026-10-22', fri, mon), mon)).toBe(3);
    expect(streakLength(set(fri, '2026-10-24', mon), mon)).toBe(3);
    expect(streakLength(set(fri), mon)).toBe(1); // nothing yet Monday; the weekend doesn't count against it
  });

  it('reads captures and writing from a daily note, ignoring the empty template', () => {
    expect(noteActivity('## Capture\n\n## Meetings\n\n## Notes\n')).toEqual({ captured: false, written: false });
    expect(noteActivity('## Capture\n- 09:41 call the vendor\n\n## Notes\n')).toEqual({ captured: true, written: true });
    expect(noteActivity('## Capture\n\n## Notes\nThinking about Q4.\n')).toEqual({ captured: false, written: true });
    expect(noteActivity('## Notes\n- 09:41 not under Capture\n')).toEqual({ captured: false, written: true });
  });

  it('counts a day as progress when a card moved forward', () => {
    let c = newCard({ id: 'A', title: 'A', now: '2026-10-20T09:00:00-04:00' });
    c = moveCard(c, 'in-progress', '2026-10-21T10:00:00-04:00');
    c = moveCard(c, 'blocked', '2026-10-22T10:00:00-04:00');
    c = moveCard(c, 'in-progress', '2026-10-23T10:00:00-04:00'); // leaving Blocked isn't "forward"
    c = moveCard(c, 'complete', '2026-10-26T10:00:00-04:00');
    expect([...progressDays([c])].sort()).toEqual(['2026-10-21', '2026-10-26']);
  });
});
