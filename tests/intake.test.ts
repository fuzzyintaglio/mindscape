import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultFiles } from '../core/files.ts';
import { DRAFT_PATH, IntakeReview, formatPending, noteLines, pendingNotes, preparePending, submitDraft } from '../core/intake.ts';
import { NoteStore } from '../core/notes.ts';
import { CardStore } from '../core/store.ts';
import { ensureVault } from '../core/vault.ts';

let vault: string;
let files: VaultFiles;
let cards: CardStore;
let notes: NoteStore;
let review: IntakeReview;
const TODAY = '2026-10-18';

beforeEach(() => {
  vault = join(mkdtempSync(join(tmpdir(), 'mindscape-intake-')), 'Vault');
  ensureVault(vault);
  files = new VaultFiles(vault);
  cards = new CardStore(vault, files);
  notes = new NoteStore(files, cards);
  review = new IntakeReview(files, cards, notes);
});
afterEach(() => rmSync(join(vault, '..'), { recursive: true, force: true }));

const write = (rel: string, text: string) => writeFileSync(join(vault, rel), text);
const read = (rel: string) => readFileSync(join(vault, rel), 'utf8');
const draft = (proposals: unknown[]) => write(DRAFT_PATH, JSON.stringify({ proposals }));
const DAY = '## Capture\n- 09:41 call the vendor about pricing\n- 10:02 legal says review adds two weeks\n\n## Notes\nAtlas kickoff: owners are design and legal.\n';

describe('what intake reads', () => {
  it('skips headings and blank lines, and keeps the heading each line sits under', () => {
    expect(noteLines(DAY).map((l) => [l.heading, l.text])).toEqual([
      ['Capture', '- 09:41 call the vendor about pricing'],
      ['Capture', '- 10:02 legal says review adds two weeks'],
      ['Notes', 'Atlas kickoff: owners are design and legal.'],
    ]);
  });

  it("lists notes before today with lines it hasn't seen; today only when asked", () => {
    write('daily/2026-10-16.md', DAY);
    write(`daily/${TODAY}.md`, '- today thing\n');
    expect(pendingNotes(files, { today: TODAY }).map((n) => n.date)).toEqual(['2026-10-16']);
    expect(pendingNotes(files, { today: TODAY, includeToday: true }).map((n) => n.date)).toEqual(['2026-10-16', TODAY]);
    expect(formatPending(pendingNotes(files, { today: TODAY }), '/V')).toContain('## 2026-10-16 (Friday) — /V/daily/2026-10-16.md\n### Capture\n- 09:41 call the vendor');
  });
});

describe('a full run', () => {
  let card: string;

  beforeEach(() => {
    write('daily/2026-10-16.md', DAY);
    card = cards.create({ title: 'Renew vendor contract' }).card.id;
    notes.create('Legal');
  });

  const goodDraft = () => [
    { type: 'new-task', source: { date: '2026-10-16', quote: '- 09:41 call the vendor about pricing' }, title: 'Call the vendor about pricing', effort: 'low', refs: ['Atlas'] },
    { type: 'card-log', source: { date: '2026-10-16', quote: 'legal says review adds two weeks' }, cardId: card, text: 'Legal review adds two weeks' },
    { type: 'new-note', source: { date: '2026-10-16', quote: 'Atlas kickoff: owners are design and legal.' }, name: 'Atlas', text: '- Owners: design, legal', linkCards: [card] },
    { type: 'note-append', source: { date: '2026-10-16', quote: 'legal says review adds two weeks' }, note: 'legal', text: 'Review takes two weeks.' },
  ];

  it('submits, applies accepted proposals, and remembers everything it saw', () => {
    preparePending(files, { today: TODAY });
    draft(goodDraft());
    const submitted = submitDraft(files, cards, notes, new Date(2026, 9, 18, 9, 15, 12));
    expect(submitted).toMatchObject({ ok: true, runId: '2026-10-18-091512', proposals: 4, notesMarked: 1 });
    expect(existsSync(join(vault, DRAFT_PATH))).toBe(false);

    const items = review.list();
    expect(items.map((i) => i.proposal.type)).toEqual(['new-task', 'card-log', 'new-note', 'note-append']);
    expect(items[0]!.warning).toMatch(/Atlas/); // linked note doesn't exist until the new-note is accepted
    expect(items[1]!.cardTitle).toBe('Renew vendor contract');

    const result = review.decide(items.map((i) => ({ runId: i.runId, id: i.proposal.id, action: 'accept' as const })));
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.summary).toBe('1 card created, 1 card log entry added, 1 note created, 1 note updated.');

    const created = cards.list().cards.find((c) => c.title === 'Call the vendor about pricing')!;
    expect(created).toMatchObject({ effort: 'low', status: 'not-started', refs: ['[[Atlas]]'] });
    expect(created.log).toBe('- 2026-10-16 — "call the vendor about pricing" ([[2026-10-16]])');
    expect(cards.get(card)!.log).toBe('- 2026-10-16 — "Legal review adds two weeks" ([[2026-10-16]])');
    expect(cards.get(card)!.refs).toEqual(['[[Atlas]]']);
    expect(read('reference/Atlas.md')).toBe('### 2026-10-16 (from [[2026-10-16]])\n- Owners: design, legal\n');
    expect(read('reference/Legal.md')).toBe('### 2026-10-16 (from [[2026-10-16]])\nReview takes two weeks.\n');
    expect(review.list()).toEqual([]);

    // Running again proposes nothing: every line was seen.
    expect(pendingNotes(files, { today: TODAY })).toEqual([]);
    // A new line in the same note is the only thing that comes back.
    write('daily/2026-10-16.md', `${DAY}- 16:00 book the room\n`);
    expect(pendingNotes(files, { today: TODAY })[0]!.lines.map((l) => l.text)).toEqual(['- 16:00 book the room']);
  });

  it('Undo reverses a whole batch, including the decisions', () => {
    preparePending(files, { today: TODAY });
    draft(goodDraft());
    submitDraft(files, cards, notes);
    const before = { card: read(cards.get(card)!.path), legal: read('reference/Legal.md') };
    const items = review.list();
    const { undoId } = review.decide(items.map((i) => ({ runId: i.runId, id: i.proposal.id, action: 'accept' as const })));
    expect(files.undo(undoId!)).toEqual({ ok: true });
    expect(cards.list().cards.map((c) => c.title)).toEqual(['Renew vendor contract']);
    expect(read(cards.get(card)!.path)).toBe(before.card);
    expect(read('reference/Legal.md')).toBe(before.legal);
    expect(existsSync(join(vault, 'reference', 'Atlas.md'))).toBe(false);
    expect(review.list()).toHaveLength(4);
  });

  it('a rejected proposal never comes back', () => {
    preparePending(files, { today: TODAY });
    draft([{ ...goodDraft()[0], refs: [] }]);
    submitDraft(files, cards, notes);
    const [item] = review.list();
    review.decide([{ runId: item!.runId, id: item!.proposal.id, action: 'reject' }]);
    expect(review.list()).toEqual([]);
    expect(cards.list().cards).toHaveLength(1);
    expect(pendingNotes(files, { today: TODAY })).toEqual([]);
  });

  it('applies edits, and blocks stale proposals until retargeted', () => {
    preparePending(files, { today: TODAY });
    draft([{ ...goodDraft()[0], refs: ['Legal'] }, goodDraft()[1]]);
    submitDraft(files, cards, notes);
    const [task, log] = review.list();
    const other = cards.create({ title: 'Other card' }).card.id;
    cards.remove(card);
    expect(review.list()[1]!.stale).toMatch(/no longer on the board/);
    const blocked = review.decide([{ runId: log!.runId, id: log!.proposal.id, action: 'accept' }]);
    expect(blocked.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/no longer on the board/) });

    const done = review.decide([
      { runId: task!.runId, id: task!.proposal.id, action: 'accept', edits: { title: 'Call vendor re: pricing', effort: 'high', refs: [] } },
      { runId: log!.runId, id: log!.proposal.id, action: 'accept', edits: { cardId: other } },
    ]);
    expect(done.results.every((r) => r.ok)).toBe(true);
    expect(cards.list().cards.find((c) => c.title === 'Call vendor re: pricing')).toMatchObject({ effort: 'high', refs: [] });
    expect(cards.get(other)!.log).toContain('Legal review adds two weeks');
    const run = JSON.parse(read(`intake/${readdirSync(join(vault, 'intake')).find((f) => f.endsWith('.json'))}`));
    expect(run.proposals[0]).toMatchObject({ status: 'accepted', title: 'Call vendor re: pricing', result: expect.any(String) });
  });
});

describe('checking a draft', () => {
  beforeEach(() => write('daily/2026-10-16.md', DAY));

  it('explains every problem so Claude can fix it', () => {
    notes.create('Legal');
    draft([
      { type: 'new-task', source: { date: '2026-10-16', quote: 'call the vendor about prices' }, title: 'X', effort: 'low' },
      { type: 'card-log', source: { date: '2026-10-16', quote: 'call the vendor' }, cardId: 'Renew vendor contract', text: 'x' },
      { type: 'new-note', source: { date: '2026-10-16', quote: 'call the vendor' }, name: 'legal', text: 'x' },
      { type: 'note-append', source: { date: '2026-10-15', quote: 'x' }, note: 'Legal', text: 'x' },
      { type: 'new-task', source: { date: '2026-10-16', quote: 'call the vendor' }, title: 'Y', effort: 'huge' },
      { type: 'new-task', source: { date: '2026-10-16', quote: 'call the vendor' }, title: 'Z', effort: 'low', refs: ['Nope'] },
      { type: 'delete-everything' },
    ]);
    const result = submitDraft(files, cards, notes);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.stringMatching(/^Proposal 1: "source.quote" isn't in the 2026-10-16 note/),
      expect.stringMatching(/^Proposal 2: "cardId" must be the id of a card/),
      expect.stringMatching(/^Proposal 3: a note named "legal" already exists; use "note-append"/),
      expect.stringMatching(/^Proposal 4: there is no daily note for 2026-10-15/),
      expect.stringMatching(/^Proposal 5: "effort" must be one of low, medium, high/),
      expect.stringMatching(/^Proposal 6: "refs" names notes that don't exist.*Nope/),
      expect.stringMatching(/^Proposal 7: "type" must be one of/),
    ]);
    // Nothing was saved or marked seen.
    expect(existsSync(join(vault, DRAFT_PATH))).toBe(true);
    expect(review.list()).toEqual([]);
  });

  it('an empty draft just marks the shown lines as seen', () => {
    preparePending(files, { today: TODAY });
    draft([]);
    expect(submitDraft(files, cards, notes)).toMatchObject({ ok: true, runId: null, proposals: 0, notesMarked: 1 });
    expect(pendingNotes(files, { today: TODAY })).toEqual([]);
  });

  it('lines typed after `pending` ran stay unseen', () => {
    preparePending(files, { today: TODAY });
    write('daily/2026-10-16.md', `${DAY}- typed meanwhile\n`);
    draft([]);
    submitDraft(files, cards, notes);
    expect(pendingNotes(files, { today: TODAY })[0]!.lines.map((l) => l.text)).toEqual(['- typed meanwhile']);
  });
});
