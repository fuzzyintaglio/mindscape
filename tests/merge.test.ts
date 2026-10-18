import { describe, expect, it } from 'vitest';
import { merge3 } from '../core/merge.ts';

const lines = (...l: string[]) => l.join('\n');

describe('three-way merge for daily notes', () => {
  const base = lines('## Capture', '- 09:00 first', '', '## Notes', 'Morning standup');

  it('keeps edits that touch different lines', () => {
    const mine = lines('## Capture', '- 09:00 first', '', '## Notes', 'Morning standup', 'Talked about the launch');
    const theirs = lines('## Capture', '- 09:00 first', '- 09:30 from the CLI', '', '## Notes', 'Morning standup');
    expect(merge3(base, mine, theirs)).toEqual({
      ok: true,
      text: lines('## Capture', '- 09:00 first', '- 09:30 from the CLI', '', '## Notes', 'Morning standup', 'Talked about the launch'),
    });
  });

  it('keeps both when both sides add lines at the same spot', () => {
    const mine = lines('## Capture', '- 09:00 first', '- typed here', '', '## Notes', 'Morning standup');
    const theirs = lines('## Capture', '- 09:00 first', '- 09:30 captured', '', '## Notes', 'Morning standup');
    const result = merge3(base, mine, theirs);
    expect(result.ok && result.text).toBe(lines('## Capture', '- 09:00 first', '- typed here', '- 09:30 captured', '', '## Notes', 'Morning standup'));
  });

  it('reports a conflict when both sides change the same line differently', () => {
    const mine = base.replace('Morning standup', 'Morning standup (moved)');
    const theirs = base.replace('Morning standup', 'Standup cancelled');
    expect(merge3(base, mine, theirs)).toEqual({ ok: false });
  });

  it('handles the trivial cases', () => {
    expect(merge3(base, base, 'theirs')).toEqual({ ok: true, text: 'theirs' });
    expect(merge3(base, 'mine', base)).toEqual({ ok: true, text: 'mine' });
    expect(merge3(base, 'same', 'same')).toEqual({ ok: true, text: 'same' });
  });

  it('merges deletions on one side with additions on the other', () => {
    const mine = lines('## Capture', '', '## Notes', 'Morning standup');
    const theirs = lines('## Capture', '- 09:00 first', '', '## Notes', 'Morning standup', 'Afternoon');
    const result = merge3(base, mine, theirs);
    expect(result.ok && result.text).toBe(lines('## Capture', '', '## Notes', 'Morning standup', 'Afternoon'));
  });
});
