import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanNoteName, refName, rewriteLinks } from '../core/links.ts';
import { NoteStore } from '../core/notes.ts';
import { CardStore } from '../core/store.ts';
import { ensureVault } from '../core/vault.ts';

let vault: string;
let cards: CardStore;
let notes: NoteStore;

beforeEach(() => {
  vault = join(mkdtempSync(join(tmpdir(), 'mindscape-notes-')), 'Vault');
  ensureVault(vault);
  cards = new CardStore(vault);
  notes = new NoteStore(cards.files, cards);
});
afterEach(() => rmSync(join(vault, '..'), { recursive: true, force: true }));

const read = (rel: string) => readFileSync(join(vault, rel), 'utf8');

describe('links', () => {
  it('parses and rewrites wikilinks', () => {
    expect(refName('[[Project Atlas|Atlas]]')).toBe('Project Atlas');
    expect(refName('Project Atlas')).toBe('Project Atlas');
    expect(rewriteLinks('See [[project atlas]], [[Project Atlas#Team|team]] and [[Project Atlas 2]].', 'Project Atlas', 'Atlas')).toBe(
      'See [[Atlas]], [[Atlas#Team|team]] and [[Project Atlas 2]].',
    );
    expect(cleanNoteName('  a/b: c?  ')).toBe('a-b- c-');
    expect(cleanNoteName('...')).toBe('');
  });
});

describe('reference notes', () => {
  it('creates, lists, and refuses duplicate names in any case', () => {
    const created = notes.create('Project Atlas', 'Stakeholders: design, legal');
    expect(created.ok).toBe(true);
    expect(existsSync(join(vault, 'reference', 'Project Atlas.md'))).toBe(true);
    expect(notes.create('project atlas').ok).toBe(false);
    expect(notes.list()).toMatchObject([{ name: 'Project Atlas', preview: 'Stakeholders: design, legal', linkedCards: 0 }]);
    expect(notes.get('PROJECT ATLAS')?.name).toBe('Project Atlas');
  });

  it('shows the cards that link to a note, including archived ones', () => {
    notes.create('Project Atlas');
    const a = cards.create({ title: 'Send intro email' }).card;
    cards.update(a.id, { refs: ['Project Atlas'] });
    const b = cards.create({ title: 'Set timelines' }).card;
    cards.update(b.id, { refs: ['[[project atlas]]', 'Project Atlas'] });
    expect(cards.get(b.id)!.refs).toEqual(['[[project atlas]]']);
    mkdirSync(join(vault, 'archive', '2026'), { recursive: true });
    writeFileSync(
      join(vault, 'archive', '2026', 'old.md'),
      '---\nid: OLD\ntitle: Old work\nstatus: complete\nrefs: ["[[Project Atlas]]"]\narchived: 2026-10-01T09:00:00-04:00\n---\n## Notes\n',
    );
    expect(notes.get('Project Atlas')!.cards.map((c) => [c.title, c.archived])).toEqual([
      ['Send intro email', false],
      ['Set timelines', false],
      ['Old work', true],
    ]);
  });

  it('detects edits made elsewhere while editing', () => {
    notes.create('Project Atlas', 'v1');
    const base = notes.get('Project Atlas')!.text;
    expect(notes.save('Project Atlas', 'v2', base).ok).toBe(true);
    const stale = notes.save('Project Atlas', 'v3', base);
    expect(stale.ok === false && stale.reason).toBe('conflict');
    expect(read('reference/Project Atlas.md')).toBe('v2\n');
  });

  it('renames and updates every link, as one undoable change', () => {
    notes.create('Project Atlas', 'See also [[Project Atlas#Team]].');
    const card = cards.create({ title: 'Send intro email', notes: 'Context in [[Project Atlas|the note]]' }).card;
    cards.update(card.id, { refs: ['Project Atlas'] });
    writeFileSync(join(vault, 'daily', '2026-10-18.md'), '- met about [[project atlas]]\n');
    const before = read(cards.get(card.id)!.path);

    const result = notes.rename('Project Atlas', 'Atlas Launch');
    expect(result.ok && result.updated).toBe(2);
    expect(readdirSync(join(vault, 'reference'))).toEqual(['Atlas Launch.md']);
    expect(read('reference/Atlas Launch.md')).toBe('See also [[Atlas Launch#Team]].');
    expect(cards.get(card.id)!.refs).toEqual(['[[Atlas Launch]]']);
    expect(cards.get(card.id)!.notes).toBe('Context in [[Atlas Launch|the note]]');
    expect(read('daily/2026-10-18.md')).toBe('- met about [[Atlas Launch]]\n');
    expect(notes.get('Atlas Launch')!.cards).toHaveLength(1);

    expect(cards.files.undo(result.ok ? result.undoId! : '')).toEqual({ ok: true });
    expect(readdirSync(join(vault, 'reference'))).toEqual(['Project Atlas.md']);
    expect(read(cards.get(card.id)!.path)).toBe(before);
  });

  it('refuses a rename onto an existing note', () => {
    notes.create('A');
    notes.create('B');
    const result = notes.rename('A', 'b');
    expect(result.ok === false && result.reason).toBe('exists');
  });

  it('deletes to .trash and undo brings it back', () => {
    notes.create('Project Atlas', 'keep me');
    const result = notes.remove('Project Atlas');
    expect(readdirSync(join(vault, '.trash', 'reference'))).toEqual(['Project Atlas.md']);
    expect(notes.get('Project Atlas')).toBeUndefined();
    cards.files.undo(result.ok ? result.undoId : '');
    expect(notes.get('Project Atlas')!.text).toBe('keep me');
  });
});

describe('stale notes and the notes archive', () => {
  const age = (name: string, days: number) => {
    const t = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    utimesSync(join(vault, 'reference', `${name}.md`), t, t);
  };

  it('flags notes untouched for 30 days, unless a card still in play links to them', () => {
    for (const n of ['Old', 'Fresh', 'Old but linked', 'Old, done card']) notes.create(n, 'text');
    for (const n of ['Old', 'Old but linked', 'Old, done card']) age(n, 31);
    age('Fresh', 29);
    const active = cards.create({ title: 'Active work' }).card;
    cards.update(active.id, { refs: ['Old but linked'] });
    const done = cards.create({ title: 'Finished work', status: 'complete' }).card;
    cards.update(done.id, { refs: ['Old, done card'] });
    const stale = Object.fromEntries(notes.list().map((n) => [n.name, n.stale]));
    expect(stale).toEqual({ Old: true, Fresh: false, 'Old but linked': false, 'Old, done card': true });
  });

  it('archives stale notes together (one Undo), keeps them findable, and restores one', () => {
    notes.create('Year-end review', 'goals');
    notes.create('Current project', 'live');
    age('Year-end review', 60);
    const card = cards.create({ title: 'Mentions it' }).card;
    cards.update(card.id, { refs: [] });
    const result = notes.archiveStale();
    expect(result.archived).toEqual(['Year-end review']);
    expect(existsSync(join(vault, 'archive', 'notes', 'Year-end review.md'))).toBe(true);
    expect(notes.list().map((n) => n.name)).toEqual(['Current project']);
    expect(notes.listArchived().map((n) => n.name)).toEqual(['Year-end review']);
    // Links still work, and the archive of cards doesn't mistake it for a card.
    expect(notes.get('year-end review')).toMatchObject({ name: 'Year-end review', archived: true, text: 'goals' });
    expect(cards.archive().problems).toEqual([]);

    cards.undo(result.undoId!);
    expect(notes.list().map((n) => n.name).sort()).toEqual(['Current project', 'Year-end review']);
    notes.archive(['Year-end review']);
    const restored = notes.restore('Year-end review');
    expect(restored.ok && restored.note).toMatchObject({ archived: false, path: 'reference/Year-end review.md' });
    expect(notes.restore('Nope')).toMatchObject({ ok: false, reason: 'not-found' });
  });
});
