// @vitest-environment jsdom
// The real UI against the real server and a temporary vault, in-process.
// CodeMirror is swapped for a textarea (jsdom can't lay it out); everything else is real.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toLocalDate } from '../core/time.ts';
import { createApp } from '../server/app.ts';

vi.mock('../ui/src/NotesEditor.tsx', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  type Props = import('../ui/src/NotesEditor.tsx').NotesEditorProps;
  return {
    default: function MockEditor({ initial, onChange, onSave, onCancel, handleRef, initialFind }: Props) {
      const ref = React.useRef<HTMLTextAreaElement>(null);
      React.useEffect(() => {
        if (initialFind) {
          const at = ref.current!.value.toLowerCase().indexOf(initialFind.toLowerCase());
          if (at >= 0) ref.current!.setSelectionRange(at, at + initialFind.length);
        }
        if (!handleRef) return;
        const set = (text: string) => {
          ref.current!.value = text;
          onChange(text); // like CodeMirror, programmatic changes are reported too
        };
        handleRef.current = {
          getText: () => ref.current!.value,
          setText: (text) => ref.current!.value !== text && set(text),
          insert: (at, text) => set(ref.current!.value.slice(0, at) + text + ref.current!.value.slice(at)),
          focus: () => ref.current!.focus(),
          find: (text) => {
            const at = ref.current!.value.toLowerCase().indexOf(text.toLowerCase());
            if (at >= 0) ref.current!.setSelectionRange(at, at + text.length);
            return at >= 0;
          },
        };
        return () => {
          handleRef.current = null;
        };
      }, []);
      return (
        <textarea
          ref={ref}
          aria-label="Notes editor"
          defaultValue={initial}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.metaKey && e.key === 's') onSave?.();
            if (e.key === 'Escape') onCancel?.();
          }}
        />
      );
    },
  };
});

const tmp = mkdtempSync(join(tmpdir(), 'mindscape-ui-'));
const vault = join(tmp, 'Vault');
const opened: string[] = [];
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
process.env.MINDSCAPE_SETTINGS_DIR = join(tmp, 'settings');
const { app } = createApp({ vaultPath: vault, port: 4317, dev: false, openInTerminal: (p) => opened.push(p) });
const cardFile = (title: string) => {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return readFileSync(join(vault, 'tasks', `${slug}.md`), 'utf8');
};

beforeAll(() => {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
    app.request(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), host: '127.0.0.1:4317', 'sec-fetch-site': 'same-origin' },
    }),
  );
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
      onerror = null;
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('confirm', () => true);
  Element.prototype.scrollIntoView = () => {}; // jsdom doesn't lay out or scroll
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function renderApp() {
  const { App } = await import('../ui/src/App.tsx');
  render(<App />);
  if (!window.location.hash) await screen.findByText('Welcome to Mindscape — click me');
}

const tile = (title: string) => screen.getByText(title).closest('.card') as HTMLElement;

describe('the board UI', () => {
  it('shows the four columns, the welcome card, and empty-column messages', async () => {
    await renderApp();
    for (const name of ['Not Started', 'In Progress', 'Blocked', 'Complete']) expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getByText('Nothing blocked. Nice.')).toBeTruthy();
  });

  it('adds cards with Enter and keeps the box open for the next one', async () => {
    const user = userEvent.setup();
    await renderApp();
    const notStarted = screen.getByRole('region', { name: 'Not Started' });
    await user.click(within(notStarted).getByText('+ Add card'));
    await user.type(screen.getByLabelText('New card title'), 'Write the plan{Enter}');
    await user.type(screen.getByLabelText('New card title'), 'Book the room{Enter}');
    await screen.findByText('Write the plan');
    await screen.findByText('Book the room');
    expect(readdirSync(join(vault, 'tasks'))).toEqual(expect.arrayContaining(['write-the-plan.md', 'book-the-room.md']));
  });

  it('cycles effort from the chip without opening the card', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(within(tile('Book the room')).getByRole('button', { name: /Effort Medium/ }));
    await waitFor(() => expect(cardFile('Book the room')).toMatch(/\neffort: high\n/));
    expect(screen.queryByLabelText('Card details')).toBeNull();
  });

  it('opens a card, edits notes, and saves them to disk', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(tile('Write the plan'));
    const panel = await screen.findByLabelText('Card details');
    await user.click(within(panel).getByText('Click to add notes…'));
    const editor = await within(panel).findByLabelText('Notes editor');
    await user.type(editor, '## Goals{Enter}- Ship **v2**');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(cardFile('Write the plan')).toContain('## Goals\n- Ship **v2**'));
    // Back to the rendered view, still open.
    expect(await within(panel).findByRole('heading', { name: 'Goals' })).toBeTruthy();
    expect(within(panel).getByText('v2').tagName).toBe('STRONG');
  });

  it('moves a card from the panel and Undo puts the file back exactly', async () => {
    const user = userEvent.setup();
    await renderApp();
    const before = cardFile('Write the plan');
    await user.click(tile('Write the plan'));
    const panel = await screen.findByLabelText('Card details');
    await user.click(within(within(panel).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Complete' }));
    await screen.findByText('Moved to Complete');
    await waitFor(() => expect(cardFile('Write the plan')).toMatch(/\nstatus: complete\n/));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(cardFile('Write the plan')).toBe(before));
  });

  it('asks what is blocking a card when it moves to Blocked', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(tile('Book the room'));
    const panel = await screen.findByLabelText('Card details');
    await user.click(within(within(panel).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Blocked' }));
    const dialog = await screen.findByRole('dialog', { name: 'What is blocking this?' });
    await user.type(within(dialog).getByPlaceholderText(/review/), 'Facilities{Enter}');
    await waitFor(() => expect(cardFile('Book the room')).toMatch(/\nblockedBy: Facilities\n/));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await within(tile('Book the room')).findByText('Waiting on Facilities')).toBeTruthy();
  });

  it('Skip on the Blocked prompt leaves the fields empty', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(tile('Write the plan'));
    const panel = await screen.findByLabelText('Card details');
    await user.click(within(within(panel).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Blocked' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(cardFile('Write the plan')).toMatch(/\nstatus: blocked\n/));
    expect(cardFile('Write the plan')).toMatch(/\nblockedBy:\s*\n/);
  });

  it('deletes to .trash and Undo restores the card', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(within(tile('Write the plan')).getByRole('button', { name: 'Delete Write the plan' }));
    await waitFor(() => expect(screen.queryByText('Write the plan')).toBeNull());
    expect(readdirSync(join(vault, '.trash'))).toContain('write-the-plan.md');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(readdirSync(join(vault, 'tasks'))).toContain('write-the-plan.md'));
  });
});

const todayFile = () => join(vault, 'daily', `${toLocalDate()}.md`);
const slow = { timeout: 3000 };

describe('quick capture', () => {
  it("adds a line to today's note from any view, and t: makes a card", async () => {
    const user = userEvent.setup();
    await renderApp();
    const box = screen.getByLabelText('Quick capture');
    await user.type(box, 'call about timelines{Enter}');
    await waitFor(() => expect(readFileSync(todayFile(), 'utf8')).toMatch(/## Capture\n- \d\d:\d\d call about timelines\n/));
    expect((box as HTMLInputElement).value).toBe('');

    await user.type(box, 't: Captured task{Enter}');
    await screen.findByText('Captured task');
    expect(readdirSync(join(vault, 'tasks'))).toContain('captured-task.md');
  });

  it('⌘J focuses the capture box', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Meta>}j{/Meta}');
    expect(document.activeElement).toBe(screen.getByLabelText('Quick capture'));
  });
});

describe('daily notes', () => {
  it("opens today's note, autosaves typing, and captures into the open editor", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('link', { name: 'Daily' }));
    const editor = (await screen.findByLabelText('Notes editor')) as HTMLTextAreaElement;
    expect(screen.getByRole('heading', { name: /Today/ })).toBeTruthy();
    expect(screen.getByLabelText('Today')).toBeTruthy();

    await user.click(editor);
    await user.type(editor, 'Typed in the note');
    await waitFor(() => expect(readFileSync(todayFile(), 'utf8')).toContain('Typed in the note'), slow);
    await screen.findByText('Saved');

    await user.type(screen.getByLabelText('Quick capture'), 'while editing{Enter}');
    expect(editor.value).toMatch(/- \d\d:\d\d while editing/);
    expect(editor.value).toContain('Typed in the note');
    await waitFor(() => expect(readFileSync(todayFile(), 'utf8')).toMatch(/while editing[\s\S]*Typed in the note/), slow);
  });

  it('merges a change made elsewhere into the open note', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('link', { name: 'Daily' }));
    const editor = (await screen.findByLabelText('Notes editor')) as HTMLTextAreaElement;
    const disk = readFileSync(todayFile(), 'utf8');
    writeFileSync(todayFile(), disk.replace('## Meetings\n', '## Meetings\n- 1:1 added in Obsidian\n'));
    await user.type(editor, ' and more');
    await waitFor(() => {
      const saved = readFileSync(todayFile(), 'utf8');
      expect(saved).toContain('1:1 added in Obsidian');
      expect(saved).toContain('and more');
    }, slow);
    expect(editor.value).toContain('1:1 added in Obsidian');
  });

  it('shows other days, and offers to create a missing one', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/daily/2020-02-03';
    await renderApp();
    expect(await screen.findByText('No note for Monday, February 3.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create note' }));
    await screen.findByLabelText('Notes editor');
    expect(readFileSync(join(vault, 'daily', '2020-02-03.md'), 'utf8')).toContain('## Capture');
    await user.click(screen.getByRole('link', { name: 'Previous day' }));
    expect(await screen.findByText('No note for Sunday, February 2.')).toBeTruthy();
  });
});

describe('reference notes', () => {
  it('creates a note, links it from two cards, and shows it inside each', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('link', { name: 'Notes' }));
    await user.click(await screen.findByRole('button', { name: '+ New note' }));
    await user.type(screen.getByLabelText('New note name'), 'Project Atlas{Enter}');
    await user.click(await screen.findByText('Click to start writing…'));
    await user.type(await screen.findByLabelText('Notes editor'), 'Owners: design and legal');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(readFileSync(join(vault, 'reference', 'Project Atlas.md'), 'utf8')).toBe('Owners: design and legal\n'));

    await user.click(screen.getByRole('link', { name: 'Board' }));
    for (const title of ['Write the plan', 'Book the room']) {
      await user.click(await screen.findByText(title));
      const panel = await screen.findByLabelText('Card details');
      await user.click(within(panel).getByRole('button', { name: '+ Link note' }));
      await user.type(within(panel).getByLabelText('Find a note to link'), 'atlas');
      await user.click(await within(panel).findByRole('option', { name: 'Project Atlas' }));
      expect(await within(panel).findByText('Owners: design and legal')).toBeTruthy();
      expect(cardFile(title)).toContain('refs: [ "[[Project Atlas]]" ]');
    }

    window.location.hash = '#/notes/Project%20Atlas';
    const linked = await screen.findByRole('region', { name: 'Linked cards' });
    expect(await within(linked).findByText('Write the plan')).toBeTruthy();
    expect(within(linked).getByText('Book the room')).toBeTruthy();
  });

  it('renaming a note updates the cards that link to it', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/notes/Project%20Atlas';
    await renderApp();
    const name = await screen.findByLabelText('Note name');
    await user.clear(name);
    await user.type(name, 'Atlas Launch{Enter}');
    await screen.findByText(/Renamed — updated links in 2 files/);
    expect(cardFile('Write the plan')).toContain('[[Atlas Launch]]');
    expect(window.location.hash).toBe('#/notes/Atlas%20Launch');
  });

  it('creates and links a new note straight from the card picker', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(await screen.findByText('Write the plan'));
    const panel = await screen.findByLabelText('Card details');
    await user.click(within(panel).getByRole('button', { name: '+ Link note' }));
    await user.type(within(panel).getByLabelText('Find a note to link'), 'Vendor contacts{Enter}');
    await within(panel).findByRole('link', { name: 'Vendor contacts' });
    expect(readdirSync(join(vault, 'reference'))).toContain('Vendor contacts.md');
    expect(cardFile('Write the plan')).toContain('[[Vendor contacts]]');
  });
});

describe('search', () => {
  it('⌘K finds a word across cards, notes, and daily notes, and Enter opens the result', async () => {
    const user = userEvent.setup();
    writeFileSync(todayFile(), '## Capture\n\n## Notes\nLong day.\nMet the platypus team about launch.\n');
    await renderApp();
    await user.click(within(tile('Write the plan')).getByText('Write the plan'));
    const panel = await screen.findByLabelText('Card details');
    await user.click(within(panel).getByText(/Goals/));
    const notes = await within(panel).findByLabelText('Notes editor');
    await user.type(notes, '{Enter}Ask the platypus team');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await user.click(within(panel).getByRole('button', { name: 'Close card' }));
    await user.click(screen.getByRole('link', { name: 'Notes' }));
    await user.click(await screen.findByRole('button', { name: '+ New note' }));
    await user.type(screen.getByLabelText('New note name'), 'Platypus team{Enter}');
    await screen.findByLabelText('Note name');

    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    await user.type(within(dialog).getByRole('combobox'), 'platypus');
    for (const group of ['Cards', 'Reference notes', 'Daily notes']) expect(await within(dialog).findByRole('region', { name: group })).toBeTruthy();
    expect(within(dialog).getAllByText('platypus', { selector: 'mark' }).length).toBeGreaterThan(1);

    // Cards come first: Enter opens the card in the side panel.
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
    expect(await screen.findByLabelText('Card details')).toBeTruthy();

    // "/" reopens it; arrow down to the daily note jumps to the matching text.
    await user.click(document.body);
    await user.keyboard('/');
    const again = await screen.findByRole('dialog', { name: 'Search' });
    await user.type(within(again).getByRole('combobox'), 'platypus');
    const daily = await within(again).findByRole('region', { name: 'Daily notes' });
    await user.click(within(daily).getByRole('option'));
    const editor = (await screen.findByLabelText('Notes editor')) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value.slice(editor.selectionStart, editor.selectionEnd).toLowerCase()).toBe('platypus'));
  });

  it('tolerates typos and says so when nothing matches', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    const input = within(dialog).getByRole('combobox');
    await user.type(input, 'platypuss');
    expect((await within(dialog).findAllByText('close match')).length).toBeGreaterThan(0);
    await user.clear(input);
    await user.type(input, 'zzzqqq');
    expect(await within(dialog).findByText('Nothing matches “zzzqqq”.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });
});

describe('intake review', () => {
  it('shows the badge, applies an accepted proposal, accepts an edited one, and rejects one', async () => {
    const user = userEvent.setup();
    writeFileSync(join(vault, 'daily', '2020-05-04.md'), '- need to renew the parking pass\n- printer is broken again\n- facilities said badges are ready\n');
    const proposals = [
      { id: 'p1', status: 'pending', type: 'new-task', source: { date: '2020-05-04', quote: 'need to renew the parking pass' }, title: 'Renew the parking pass', effort: 'low', refs: [] },
      { id: 'p2', status: 'pending', type: 'new-task', source: { date: '2020-05-04', quote: 'printer is broken again' }, title: 'Fix printer', effort: 'low', refs: [], why: 'Sounds urgent' },
      { id: 'p3', status: 'pending', type: 'new-note', source: { date: '2020-05-04', quote: 'facilities said badges are ready' }, name: 'Facilities', text: '- Badges are ready', linkCards: [] },
    ];
    writeFileSync(join(vault, 'intake', '2020-05-05-080000.json'), JSON.stringify({ id: '2020-05-05-080000', created: '', proposals }));

    await renderApp();
    expect(await screen.findByLabelText('3 to review')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /Intake/ }));

    const tasks = await screen.findByRole('region', { name: 'New tasks' });
    const [renew, printer] = within(tasks).getAllByRole('article');
    expect(within(printer!).getByText('Sounds urgent')).toBeTruthy();

    await user.click(within(renew!).getByRole('button', { name: 'Accept' }));
    await screen.findByText('1 card created.');
    await waitFor(() => expect(readdirSync(join(vault, 'tasks'))).toContain('renew-the-parking-pass.md'));
    expect(cardFile('Renew the parking pass')).toContain('- 2020-05-04 — "need to renew the parking pass" ([[2020-05-04]])');

    const printerCard = await within(screen.getByRole('region', { name: 'New tasks' })).findByRole('article');
    await user.click(within(printerCard).getByRole('button', { name: 'Edit' }));
    const titleInput = within(printerCard).getByLabelText('Card title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Call IT about the printer');
    await user.click(within(within(printerCard).getByRole('group', { name: 'Effort' })).getByRole('button', { name: 'High' }));
    await user.click(within(printerCard).getByRole('button', { name: 'Accept with changes' }));
    await waitFor(() => expect(cardFile('Call IT about the printer')).toMatch(/\neffort: high\n/));

    const notesGroup = await screen.findByRole('region', { name: 'New reference notes' });
    await user.click(within(notesGroup).getByRole('button', { name: 'Reject all' }));
    expect(await screen.findByText('Nothing to review.')).toBeTruthy();
    expect(readdirSync(join(vault, 'reference'))).not.toContain('Facilities.md');
    const run = JSON.parse(readFileSync(join(vault, 'intake', '2020-05-05-080000.json'), 'utf8'));
    expect(run.proposals.map((p: { status: string }) => p.status)).toEqual(['accepted', 'accepted', 'rejected']);
  });
});

describe('Run /mindscape button', () => {
  it("shows on today's note while past days are unprocessed, and on an empty Intake screen", async () => {
    const user = userEvent.setup();
    writeFileSync(join(vault, 'daily', '2020-07-01.md'), '- an unprocessed line\n');
    window.location.hash = '#/daily';
    await renderApp();
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(await within(today).findByText(/days? of notes not processed yet/)).toBeTruthy();
    await user.click(within(today).getByRole('button', { name: 'Run /mindscape' }));
    expect(await screen.findByText(/Opened Claude Code in Terminal|Updated the \/mindscape skill/)).toBeTruthy();
    expect(opened).toHaveLength(1);
    expect(readFileSync(opened[0]!, 'utf8')).toContain("'/mindscape include today'");

    // Include today is on by default; unchecking it runs past days only.
    await user.click(screen.getByRole('link', { name: /Intake/ }));
    const include = (await screen.findByLabelText('Include today')) as HTMLInputElement;
    expect(include.checked).toBe(true);
    await user.click(include);
    await user.click(screen.getByRole('button', { name: 'Run /mindscape' }));
    await waitFor(() => expect(opened).toHaveLength(2));
    expect(readFileSync(opened[1]!, 'utf8').trimEnd().endsWith("'/mindscape'")).toBe(true);
  });
});
