// @vitest-environment jsdom
// The real UI against the real server and a temporary vault, in-process.
// CodeMirror is swapped for a textarea (jsdom can't lay it out); everything else is real.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.ts';

vi.mock('../ui/src/NotesEditor.tsx', () => ({
  default: ({ initial, onChange, onSave, onCancel }: { initial: string; onChange: (s: string) => void; onSave: () => void; onCancel: () => void }) => (
    <textarea
      aria-label="Notes editor"
      defaultValue={initial}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.metaKey && e.key === 's') onSave();
        if (e.key === 'Escape') onCancel();
      }}
    />
  ),
}));

const tmp = mkdtempSync(join(tmpdir(), 'mindscape-ui-'));
const vault = join(tmp, 'Vault');
const { app } = createApp({ vaultPath: vault, port: 4317, dev: false });
const cardFile = (title: string) => {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return readFileSync(join(vault, 'tasks', `${slug}.md`), 'utf8');
};

beforeAll(() => {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
    app.request(url, { ...init, headers: { ...(init.headers as Record<string, string>), host: '127.0.0.1:4317' } }),
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
});
afterEach(cleanup);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function renderApp() {
  const { App } = await import('../ui/src/App.tsx');
  render(<App />);
  await screen.findByText('Welcome to Mindscape — click me');
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
