import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CardStore } from '../core/store.ts';
import { ensureVault } from '../core/vault.ts';

let vault: string;
let store: CardStore;

beforeEach(() => {
  vault = join(mkdtempSync(join(tmpdir(), 'mindscape-store-')), 'Vault');
  ensureVault(vault);
  store = new CardStore(vault);
});
afterEach(() => rmSync(join(vault, '..'), { recursive: true, force: true }));

const read = (rel: string) => readFileSync(join(vault, rel), 'utf8');
const files = (folder: string) => (existsSync(join(vault, folder)) ? readdirSync(join(vault, folder)) : []);

describe('creating and listing', () => {
  it('creates a card file named after the title', () => {
    const { card } = store.create({ title: 'Write the Q3 plan' });
    expect(card.path).toBe('tasks/write-the-q3-plan.md');
    expect(card.effort).toBe('medium');
    expect(store.list().cards.map((c) => c.title)).toEqual(['Write the Q3 plan']);
  });

  it('gives duplicate titles unique file names', () => {
    store.create({ title: 'Same' });
    const second = store.create({ title: 'Same' }).card;
    expect(second.path).toBe('tasks/same-2.md');
    expect(store.list().cards).toHaveLength(2);
  });

  it('reports unreadable files instead of failing', () => {
    store.create({ title: 'Good' });
    writeFileSync(join(vault, 'tasks', 'broken.md'), '---\nid: [oops\n---\n');
    const { cards, problems } = store.list();
    expect(cards).toHaveLength(1);
    expect(problems).toEqual([{ path: 'tasks/broken.md', error: expect.any(String) }]);
    expect(read('tasks/broken.md')).toBe('---\nid: [oops\n---\n'); // untouched
  });
});

describe('updating', () => {
  it('renames the file when the title changes, keeping the id', () => {
    const { card } = store.create({ title: 'Old name' });
    const result = store.update(card.id, { title: 'New name' });
    expect(result.ok && result.card.path).toBe('tasks/new-name.md');
    expect(files('tasks')).toEqual(['new-name.md']);
    expect(store.get(card.id)?.title).toBe('New name');
  });

  it('keeps unknown fields someone added by hand', () => {
    const { card } = store.create({ title: 'Card' });
    writeFileSync(join(vault, card.path), read(card.path).replace('---\n## Notes', 'myField: keep me\n---\n## Notes'));
    store.update(card.id, { effort: 'high' });
    expect(read(card.path)).toContain('myField: keep me');
  });

  it('flags a conflict only when the notes changed elsewhere', () => {
    const { card } = store.create({ title: 'Card' });
    store.update(card.id, { notes: 'v1' });
    // Another field changing is not a conflict for the notes editor…
    store.update(card.id, { effort: 'low' });
    expect(store.update(card.id, { notes: 'mine', baseNotes: 'v1' }).ok).toBe(true);
    // …but notes changing underneath it is.
    store.update(card.id, { notes: 'theirs' });
    const result = store.update(card.id, { notes: 'mine again', baseNotes: 'mine' });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.get(card.id)?.notes).toBe('theirs');
  });

  it('returns not-found for unknown ids', () => {
    expect(store.update('nope', { title: 'x' })).toEqual({ ok: false, reason: 'not-found' });
  });

  it('reports no undo when nothing changed', () => {
    const { card } = store.create({ title: 'Card' });
    expect(store.update(card.id, { effort: 'medium' })).toMatchObject({ ok: true, undoId: null });
  });
});

describe('undo', () => {
  it('restores the file exactly, including history', () => {
    const { card } = store.create({ title: 'Card' });
    const before = read(card.path);
    const result = store.update(card.id, { status: 'complete' });
    expect(result.ok && result.undoId).toBeTruthy();
    expect(store.undo((result as { undoId: string }).undoId)).toEqual({ ok: true });
    expect(read(card.path)).toBe(before);
  });

  it('undoes a rename back to the original file', () => {
    const { card } = store.create({ title: 'First' });
    const before = read(card.path);
    const r = store.update(card.id, { title: 'Second' }) as { undoId: string };
    store.undo(r.undoId);
    expect(files('tasks')).toEqual(['first.md']);
    expect(read('tasks/first.md')).toBe(before);
  });

  it('refuses to undo if the card changed again since', () => {
    const { card } = store.create({ title: 'Card' });
    const r = store.update(card.id, { status: 'in-progress' }) as { undoId: string };
    store.update(card.id, { effort: 'high' });
    expect(store.undo(r.undoId)).toEqual({ ok: false, reason: 'changed' });
    expect(store.get(card.id)?.status).toBe('in-progress');
  });

  it('can only undo once', () => {
    const { card } = store.create({ title: 'Card' });
    const r = store.update(card.id, { status: 'blocked' }) as { undoId: string };
    store.undo(r.undoId);
    expect(store.undo(r.undoId)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('deleting', () => {
  it('moves the card to .trash and undo brings it back', () => {
    const { card } = store.create({ title: 'Doomed' });
    const before = read(card.path);
    const r = store.remove(card.id) as { ok: true; undoId: string };
    expect(files('tasks')).toEqual([]);
    expect(files('.trash')).toEqual(['doomed.md']);
    store.undo(r.undoId);
    expect(read('tasks/doomed.md')).toBe(before);
    expect(files('.trash')).toEqual([]);
  });
});

describe('auto-archive', () => {
  it('moves Complete cards past the cutoff into archive/<year>/ and stamps them', () => {
    const { card } = store.create({ title: 'Done thing' });
    store.update(card.id, { status: 'complete' });
    const keep = store.create({ title: 'Still open' }).card;

    const completed = store.get(card.id)!.completed!;
    const eightDaysLater = new Date(Date.parse(completed) + 8 * 86400_000);
    expect(store.archiveDue(7, eightDaysLater)).toBe(1);

    const year = completed.slice(0, 4);
    expect(files(`archive/${year}`)).toEqual(['done-thing.md']);
    expect(read(`archive/${year}/done-thing.md`)).toMatch(/\narchived: \S+/);
    expect(store.list().cards.map((c) => c.id)).toEqual([keep.id]);
  });

  it('leaves recent completions on the board', () => {
    const { card } = store.create({ title: 'Just done' });
    store.update(card.id, { status: 'complete' });
    expect(store.archiveDue(7)).toBe(0);
  });
});

describe('first run', () => {
  it('adds one welcome card the first time only', () => {
    expect(store.ensureWelcome()).toBe(true);
    expect(store.list().cards).toHaveLength(1);
    expect(store.list().cards[0]!.notes).toContain('Add a card');
    store.remove(store.list().cards[0]!.id);
    expect(store.ensureWelcome()).toBe(false);
    expect(store.list().cards).toHaveLength(0); // not re-created after you delete it
  });

  it('does not add a welcome card to a vault that already has cards', () => {
    store.create({ title: 'Mine' });
    store.ensureWelcome();
    expect(store.list().cards.map((c) => c.title)).toEqual(['Mine']);
  });
});
