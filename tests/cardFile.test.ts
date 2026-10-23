import { describe, expect, it } from 'vitest';
import { newCard } from '../core/cards.ts';
import { joinBody, parseCard, serializeCard, splitBody } from '../core/cardFile.ts';

// The example from the plan, written by hand (flow-style history, blank fields).
const PLAN_EXAMPLE = `---
id: 01JAB3EXAMPLE
title: Send intro email for Project Alpha
status: in-progress
effort: medium
refs: ["[[Project Alpha]]"]
created: 2026-10-14T09:12-04:00
updated: 2026-10-17T10:03-04:00
enteredColumn: 2026-10-17T09:30-04:00
completed:
archived:
blockedBy:
unblockBy:
statusHistory:
  - {status: not-started, at: 2026-10-14T09:12-04:00}
  - {status: blocked, at: 2026-10-16T16:05-04:00, blockedBy: "Legal review", unblockBy: 2026-10-20}
  - {status: in-progress, at: 2026-10-17T09:30-04:00}
priority: 2
---
## Notes
Free-form markdown here.

## Log
- 2026-10-17 — "legal review adds ~2 wks" ([[2026-10-17]])
`;

describe('card files', () => {
  it('reads the plan’s example file', () => {
    const { card, extra } = parseCard(PLAN_EXAMPLE);
    expect(card.title).toBe('Send intro email for Project Alpha');
    expect(card.refs).toEqual(['[[Project Alpha]]']);
    expect(card.completed).toBeNull();
    expect(card.statusHistory[1]).toEqual({ status: 'blocked', at: '2026-10-16T16:05-04:00', blockedBy: 'Legal review', unblockBy: '2026-10-20' });
    expect(card.notes).toBe('Free-form markdown here.');
    expect(card.log).toContain('legal review adds');
    expect(extra).toEqual({ priority: 2 });
  });

  it('round-trips without losing anything, including fields it does not know', () => {
    const first = parseCard(PLAN_EXAMPLE);
    const written = serializeCard(first.card, first.extra);
    const again = parseCard(written);
    expect(again.card).toEqual(first.card);
    expect(again.extra).toEqual({ priority: 2 });
    expect(serializeCard(again.card, again.extra)).toBe(written); // stable
  });

  it('writes one line per history entry and leaves empty fields blank', () => {
    const text = serializeCard(newCard({ id: 'A', title: 'T', now: '2026-10-17T09:00:00-04:00' }));
    expect(text).toMatch(/\n {2}- \{ status: not-started, at: "?2026-10-17T09:00:00-04:00"? \}\n/);
    expect(text).toMatch(/\ncompleted:\s*\n/);
    expect(text).toContain('## Notes');
  });

  it('reads and writes a due date, quoted or not', () => {
    const withDue = PLAN_EXAMPLE.replace('effort: medium\n', 'effort: medium\ndue: 2026-10-30\n');
    const { card, extra } = parseCard(withDue);
    expect(card.due).toBe('2026-10-30');
    expect(parseCard(serializeCard(card, extra)).card.due).toBe('2026-10-30');
    expect(parseCard(PLAN_EXAMPLE).card.due).toBeNull();
    expect(parseCard(PLAN_EXAMPLE.replace('effort: medium\n', 'effort: medium\ndue: soon\n')).card.due).toBeNull();
  });

  it('reads and writes the blocking card, and leaves the field out when there is none', () => {
    const blocked = { ...newCard({ id: 'A', title: 'T', now: '2026-10-17T09:00:00-04:00' }), status: 'blocked' as const, blockedByCard: 'B1' };
    const text = serializeCard(blocked);
    expect(text).toContain('\nblockedByCard: B1\n');
    expect(parseCard(text).card.blockedByCard).toBe('B1');
    expect(serializeCard(newCard({ id: 'A', title: 'T', now: '2026-10-17T09:00:00-04:00' }))).not.toContain('blockedByCard');
  });

  it('keeps titles with YAML-special characters intact', () => {
    const c = newCard({ id: 'A', title: 'Q3: "plan" — #1 & more', now: '2026-10-17T09:00:00-04:00' });
    expect(parseCard(serializeCard(c)).card.title).toBe('Q3: "plan" — #1 & more');
  });

  it('gives a clear error for files that are not valid cards', () => {
    expect(() => parseCard('just some text')).toThrow(/id/);
    expect(() => parseCard('---\nid: A\ntitle: T\nstatus: done\n---\n')).toThrow(/status "done"/);
    expect(() => parseCard('---\nid: [unclosed\n---\n')).toThrow();
  });
});

describe('notes and log', () => {
  it('splits on the last "## Log" heading', () => {
    expect(splitBody('## Notes\nhello\n\n## Log\n- a')).toEqual({ notes: 'hello', log: '- a' });
  });

  it('treats a file without headings as all notes', () => {
    expect(splitBody('just notes\nmore')).toEqual({ notes: 'just notes\nmore', log: '' });
  });

  it('only the last Log heading counts', () => {
    expect(splitBody('## Notes\n## Log\nin notes\n## Log\n- real')).toEqual({ notes: '## Log\nin notes', log: '- real' });
  });

  it('joins back into the same shape', () => {
    expect(joinBody('hello', '- a')).toBe('## Notes\nhello\n\n## Log\n- a\n');
    expect(joinBody('', '')).toBe('## Notes\n');
  });
});
