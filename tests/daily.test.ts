import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../core/capture.ts';
import {
  applyInsertion,
  captureInsertion,
  captureLine,
  ensureDaily,
  ensureDailyTemplate,
  renderTemplate,
  taskFromCapture,
} from '../core/daily.ts';
import { VaultFiles } from '../core/files.ts';
import { CardStore } from '../core/store.ts';
import { ensureVault } from '../core/vault.ts';

let vault: string;
let files: VaultFiles;

beforeEach(() => {
  vault = join(mkdtempSync(join(tmpdir(), 'mindscape-daily-')), 'Vault');
  ensureVault(vault);
  files = new VaultFiles(vault);
});
afterEach(() => rmSync(join(vault, '..'), { recursive: true, force: true }));

const at = (h: number, m: number) => new Date(2026, 9, 18, h, m);

describe('daily notes', () => {
  it('creates the note from the template, once', () => {
    ensureDailyTemplate(files);
    const first = ensureDaily(files, '2026-10-18');
    expect(first.created).toBe(true);
    expect(first.text).toBe('## Capture\n\n## Meetings\n\n## Notes\n');
    writeFileSync(join(vault, 'daily', '2026-10-18.md'), 'my own text');
    expect(ensureDaily(files, '2026-10-18')).toEqual({ text: 'my own text', created: false });
  });

  it('never overwrites an edited template', () => {
    writeFileSync(join(vault, 'templates', 'daily.md'), '# {{date:dddd, MMMM D}}\n');
    ensureDailyTemplate(files);
    expect(ensureDaily(files, '2026-10-18').text).toBe('# Sunday, October 18\n');
  });

  it('fills in template placeholders', () => {
    expect(renderTemplate('{{date}} · {{title}} · {{date:ddd D MMM YYYY}}', '2026-10-05')).toBe('2026-10-05 · 2026-10-05 · Mon 5 Oct 2026');
  });
});

describe('capture', () => {
  const note = '## Capture\n- 09:00 first\n\n## Meetings\n\n## Notes\n';

  it('adds the line at the end of the Capture section', () => {
    const line = captureLine('call about timelines', at(9, 41));
    expect(line).toBe('- 09:41 call about timelines');
    expect(applyInsertion(note, captureInsertion(note, line))).toBe('## Capture\n- 09:00 first\n- 09:41 call about timelines\n\n## Meetings\n\n## Notes\n');
  });

  it('works in an empty Capture section and adds a section when there is none', () => {
    const empty = '## Capture\n\n## Notes\n';
    expect(applyInsertion(empty, captureInsertion(empty, '- x'))).toBe('## Capture\n- x\n\n## Notes\n');
    expect(applyInsertion('Some text', captureInsertion('Some text', '- x'))).toBe('Some text\n\n## Capture\n- x\n');
    expect(applyInsertion('', captureInsertion('', '- x'))).toBe('## Capture\n- x\n');
  });

  it('treats t: as a new card and everything else as a note', () => {
    expect(taskFromCapture('t: Call the vendor')).toEqual({ title: 'Call the vendor', effort: 'medium' });
    expect(taskFromCapture('T:Send deck')).toEqual({ title: 'Send deck', effort: 'medium' });
    expect(taskFromCapture('note: not a task')).toBeNull();
    expect(taskFromCapture('t:   ')).toBeNull();
  });

  it('reads effort prefixes: t! is High, t- is Low', () => {
    expect(taskFromCapture('t! Ship the deck')).toEqual({ title: 'Ship the deck', effort: 'high' });
    expect(taskFromCapture('t!: Ship the deck')).toEqual({ title: 'Ship the deck', effort: 'high' });
    expect(taskFromCapture('t- tidy the drive')).toEqual({ title: 'tidy the drive', effort: 'low' });
    expect(taskFromCapture('T-:tidy')).toEqual({ title: 'tidy', effort: 'low' });
    // Without a space or colon after it, it's just a note.
    expect(taskFromCapture('t-shirt order for the offsite')).toBeNull();
    expect(taskFromCapture('t!nope')).toBeNull();
    expect(taskFromCapture('t!   ')).toBeNull();
  });

  it('reads a due date from the end of a card capture', () => {
    const fri = '2026-10-23'; // a Friday
    expect(taskFromCapture('t: send deck @today', fri)).toEqual({ title: 'send deck', effort: 'medium', due: fri });
    expect(taskFromCapture('t!: send deck @fri', fri)).toEqual({ title: 'send deck', effort: 'high', due: '2026-10-30' });
    expect(taskFromCapture('t- tidy up @tomorrow', fri)).toMatchObject({ due: '2026-10-24' });
    expect(taskFromCapture('t: call @monday', fri)).toMatchObject({ title: 'call', due: '2026-10-26' });
    expect(taskFromCapture('t: call @10/30', fri)).toMatchObject({ due: '2026-10-30' });
    expect(taskFromCapture('t: renew @1/5', fri)).toMatchObject({ due: '2027-01-05' });
    expect(taskFromCapture('t: renew @2027-02-01', fri)).toMatchObject({ due: '2027-02-01' });
    expect(taskFromCapture('t: renew @2/30', fri)).toEqual({ title: 'renew @2/30', effort: 'medium' });
    // Not a date: stays in the title. Only the end of the line counts.
    expect(taskFromCapture('t: ping @alice', fri)).toEqual({ title: 'ping @alice', effort: 'medium' });
    expect(taskFromCapture('t: @fri standup notes', fri)).toEqual({ title: '@fri standup notes', effort: 'medium' });
    expect(taskFromCapture('t: @fri', fri)).toEqual({ title: '@fri', effort: 'medium' });
  });

  it('capture() makes cards (with effort and due date) and appends everything else to the note', () => {
    ensureDailyTemplate(files);
    const store = new CardStore(vault, files);
    const card = capture(store, 't: Call the vendor');
    expect(card.kind === 'card' && card.card.status).toBe('not-started');
    const dated = capture(store, 't! Send the deck @tomorrow', at(9, 0));
    expect(dated.kind === 'card' && { effort: dated.card.effort, due: dated.card.due }).toEqual({ effort: 'high', due: '2026-10-19' });
    const result = capture(store, 'remember the deck', at(10, 5));
    expect(result).toEqual({ kind: 'note', date: '2026-10-18', line: '- 10:05 remember the deck' });
    expect(readFileSync(join(vault, 'daily', '2026-10-18.md'), 'utf8')).toBe('## Capture\n- 10:05 remember the deck\n\n## Meetings\n\n## Notes\n');
  });
});
