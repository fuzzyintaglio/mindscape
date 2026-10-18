import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultFiles } from '../core/files.ts';
import { NoteStore } from '../core/notes.ts';
import { SearchIndex, snippetOf } from '../core/search.ts';
import { CardStore } from '../core/store.ts';
import { ensureVault } from '../core/vault.ts';

let vault: string;
let cards: CardStore;
let notes: NoteStore;
let search: SearchIndex;

beforeEach(() => {
  vault = join(mkdtempSync(join(tmpdir(), 'mindscape-search-')), 'Vault');
  ensureVault(vault);
  const files = new VaultFiles(vault);
  cards = new CardStore(vault, files);
  notes = new NoteStore(files, cards);
  search = new SearchIndex(files);
});
afterEach(() => rmSync(join(vault, '..'), { recursive: true, force: true }));

const write = (rel: string, text: string) => {
  mkdirSync(join(vault, rel, '..'), { recursive: true });
  writeFileSync(join(vault, rel), text);
};
const kinds = (q: string) => search.search(q).map((h) => `${h.kind}:${h.title}`);

describe('search', () => {
  beforeEach(() => {
    const { card } = cards.create({ title: 'Renew the vendor contract', notes: 'Waiting for the signed copy.' });
    cards.update(card.id, { refs: ['Supplier Hub'] });
    notes.create('Supplier Hub', '# People\nThe vendor contact is Sam in procurement.');
    write('daily/2026-10-16.md', '## Notes\nCalled the vendor about pricing.\n');
    write('reviews/2026-W42.md', '# Week 42\nClosed the vendor renewal.');
    write(
      'archive/2026/old.md',
      '---\nid: OLD\ntitle: Pick a vendor\nstatus: complete\narchived: 2026-10-01T09:00:00-04:00\n---\n## Notes\nChose the second one.\n',
    );
  });

  it('finds a word in cards, archived cards, notes, daily notes, and reviews', () => {
    expect(kinds('vendor').sort()).toEqual([
      'card:Pick a vendor',
      'card:Renew the vendor contract',
      'daily:2026-10-16',
      'reference:Supplier Hub',
      'review:2026-W42',
    ]);
    const archived = search.search('vendor').find((h) => h.key === 'OLD')!;
    expect(archived).toMatchObject({ archived: true, status: 'complete' });
  });

  it('ranks title matches higher and returns a snippet around the match', () => {
    const [top] = search.search('procurement');
    expect(top).toMatchObject({ kind: 'reference', title: 'Supplier Hub', exact: true });
    expect(top!.snippet).toBe('People The vendor contact is Sam in procurement.');
    expect(search.search('contract')[0]!.title).toBe('Renew the vendor contract');
  });

  it('matches word beginnings, needs every word, and tolerates typos after exact matches', () => {
    expect(kinds('procure')).toEqual(['reference:Supplier Hub']);
    expect(kinds('vendor pricing')).toEqual(['daily:2026-10-16']);
    const typo = search.search('vendr');
    expect(typo.length).toBeGreaterThan(0);
    expect(typo.every((h) => !h.exact)).toBe(true);
  });

  it('finds daily notes by weekday and month, and cards by linked note', () => {
    expect(kinds('friday october')).toEqual(['daily:2026-10-16']);
    expect(kinds('supplier')).toEqual(['reference:Supplier Hub', 'card:Renew the vendor contract']);
  });

  it('picks up edits, new files, and deletions without a restart', () => {
    expect(kinds('kiwi')).toEqual([]);
    write('daily/2026-10-16.md', '## Notes\nBought a kiwi.\n');
    write('reference/Fruit.md', 'kiwi and mango');
    expect(kinds('kiwi').sort()).toEqual(['daily:2026-10-16', 'reference:Fruit']);
    expect(kinds('pricing')).toEqual([]);
    unlinkSync(join(vault, 'reference', 'Fruit.md'));
    expect(kinds('kiwi')).toEqual(['daily:2026-10-16']);
  });

  it('stays fast on a large vault', () => {
    for (let i = 0; i < 1500; i++) write(`daily/2020-${String((i % 12) + 1).padStart(2, '0')}-${i}.md`, `Meeting ${i} about topic${i % 50} and the quarterly budget.\n`.repeat(20));
    search.search('warmup');
    const started = performance.now();
    expect(search.search('budget topic7').length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('snippets', () => {
  it('centers on the first match at a word start and trims to whole words', () => {
    const text = `${'lorem ipsum '.repeat(30)}the report was late but the port opened ${'dolor sit '.repeat(30)}`;
    const snippet = snippetOf(text, ['port']);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet).toContain('the port opened');
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(200);
  });
});
