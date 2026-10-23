import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { toLocalDate } from '../core/time.ts';
import { createApp } from '../server/app.ts';

const tmp = mkdtempSync(join(tmpdir(), 'mindscape-api-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const opened: string[] = [];
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
process.env.MINDSCAPE_SETTINGS_DIR = join(tmp, 'settings');
const { app } = createApp({ vaultPath: join(tmp, 'Vault'), port: 4317, dev: false, openInTerminal: (p) => opened.push(p) });
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('board API', () => {
  it('starts with the welcome card and default config', async () => {
    const res = await call('GET', '/api/board');
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(body.config.archiveAfterDays).toBe(7);
    expect(body.config.points).toEqual({ low: 100, medium: 300, high: 750 });
  });

  it('creates, moves, undoes, and deletes a card', async () => {
    const created = await (await call('POST', '/api/cards', { title: 'From the API', status: 'in-progress' })).json();
    expect(created.card.status).toBe('in-progress');

    const moved = await (await call('PATCH', `/api/cards/${created.card.id}`, { status: 'blocked' })).json();
    expect(moved.card.status).toBe('blocked');

    const blocker = await (await call('PATCH', `/api/cards/${created.card.id}`, { blockedBy: 'Review', unblockBy: '2026-10-20' })).json();
    expect(blocker.card).toMatchObject({ blockedBy: 'Review', unblockBy: '2026-10-20' });

    expect((await call('POST', `/api/undo/${blocker.undoId}`)).status).toBe(200);
    expect((await call('POST', `/api/undo/${moved.undoId}`)).status).toBe(200);
    const board = await (await call('GET', '/api/board')).json();
    expect(board.cards.find((c: { id: string }) => c.id === created.card.id).status).toBe('in-progress');

    expect((await call('DELETE', `/api/cards/${created.card.id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/cards/${created.card.id}`)).status).toBe(404);
  });

  it('sets and clears a due date', async () => {
    const { card } = await (await call('POST', '/api/cards', { title: 'Has a deadline', due: '2026-10-30' })).json();
    expect(card.due).toBe('2026-10-30');
    const moved = await (await call('PATCH', `/api/cards/${card.id}`, { due: '2026-11-02' })).json();
    expect(moved.card.due).toBe('2026-11-02');
    const cleared = await (await call('PATCH', `/api/cards/${card.id}`, { due: null })).json();
    expect(cleared.card.due).toBeNull();
    expect((await call('POST', '/api/cards', { title: 'Bad', due: 'Friday' })).status).toBe(400);
  });

  it('returns 409 when notes changed elsewhere', async () => {
    const { card } = await (await call('POST', '/api/cards', { title: 'Notes card' })).json();
    await call('PATCH', `/api/cards/${card.id}`, { notes: 'theirs' });
    const res = await call('PATCH', `/api/cards/${card.id}`, { notes: 'mine', baseNotes: '' });
    expect(res.status).toBe(409);
    expect((await res.json()).card.notes).toBe('theirs');
  });

  it('rejects bad input', async () => {
    expect((await call('POST', '/api/cards', { title: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/cards', { title: 'x', status: 'done' })).status).toBe(400);
    const { card } = await (await call('POST', '/api/cards', { title: 'Valid' })).json();
    expect((await call('PATCH', `/api/cards/${card.id}`, { effort: 'huge' })).status).toBe(400);
    expect((await call('PATCH', `/api/cards/${card.id}`, { unblockBy: 'next week' })).status).toBe(400);
    expect((await call('PATCH', `/api/cards/${card.id}`, { due: '2026-13-45' })).status).toBe(400);
    expect((await call('PATCH', '/api/cards/missing', { title: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/api/config', { theme: 'neon' })).status).toBe(400);
  });

  it('saves the theme in the vault config', async () => {
    expect((await (await call('PATCH', '/api/config', { theme: 'dark' })).json()).theme).toBe('dark');
    expect((await (await call('GET', '/api/config')).json()).theme).toBe('dark');
  });
});

describe('daily notes API', () => {
  const today = toLocalDate();

  it("creates today's note on first read, but not other days", async () => {
    const res = await (await call('GET', `/api/daily/${today}`)).json();
    expect(res.text).toContain('## Capture');
    expect((await (await call('GET', '/api/daily/2020-01-01')).json()).text).toBeNull();
    expect((await call('GET', '/api/daily/yesterday')).status).toBe(400);
  });

  it('autosaves, merging in changes made elsewhere', async () => {
    const base = (await (await call('GET', `/api/daily/${today}`)).json()).text as string;
    const theirs = base.replace('## Capture\n', '## Capture\n- 09:00 from the CLI\n');
    writeFileSync(join(tmp, 'Vault', 'daily', `${today}.md`), theirs);
    const mine = `${base}Typed in the app\n`;
    const saved = await (await call('PUT', `/api/daily/${today}`, { text: mine, base })).json();
    expect(saved.text).toBe(`${theirs}Typed in the app\n`);
    expect(readFileSync(join(tmp, 'Vault', 'daily', `${today}.md`), 'utf8')).toBe(saved.text);
  });

  it('returns 409 when the same line was changed on both sides', async () => {
    const base = 'one\ntwo\n';
    await call('PUT', '/api/daily/2020-01-02', { text: base, base: null });
    await call('PUT', '/api/daily/2020-01-02', { text: 'one\nTWO (theirs)\n', base });
    const res = await call('PUT', '/api/daily/2020-01-02', { text: 'one\ntwo (mine)\n', base });
    expect(res.status).toBe(409);
    expect((await res.json()).text).toBe('one\nTWO (theirs)\n');
    expect((await call('PUT', '/api/daily/2020-01-02', { text: 'mine wins', base, force: true })).status).toBe(200);
  });
});

describe('capture API', () => {
  const capture = (headers: Record<string, string>, text: string) =>
    app.request('/api/capture', {
      method: 'POST',
      headers: { host: '127.0.0.1:4317', 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ text }),
    });

  it('needs the token unless the request comes from the page', async () => {
    expect((await capture({}, 'no token')).status).toBe(401);
    expect((await capture({ authorization: 'Bearer wrong' }, 'bad token')).status).toBe(401);
    const token = JSON.parse(readFileSync(join(tmp, 'Vault', '.mindscape', 'config.json'), 'utf8')).captureToken;
    expect((await capture({ authorization: `Bearer ${token}` }, 'from a shortcut')).status).toBe(201);
    expect((await capture({ 'sec-fetch-site': 'same-origin' }, 'from the page')).status).toBe(201);
    const note = readFileSync(join(tmp, 'Vault', 'daily', `${toLocalDate()}.md`), 'utf8');
    expect(note).toMatch(/- \d\d:\d\d from a shortcut\n- \d\d:\d\d from the page/);
  });

  it('turns t: into a card, and never sends the token to the page', async () => {
    const res = await (await capture({ 'sec-fetch-site': 'same-origin' }, 't: Captured task')).json();
    expect(res).toMatchObject({ kind: 'card', card: { title: 'Captured task', status: 'not-started' } });
    const high = await (await capture({ 'sec-fetch-site': 'same-origin' }, 't! Urgent task')).json();
    expect(high).toMatchObject({ kind: 'card', card: { title: 'Urgent task', effort: 'high' } });
    expect(JSON.stringify(await (await call('GET', '/api/board')).json())).not.toContain('captureToken');
  });
});

describe('reference notes API', () => {
  const path = (name: string) => `/api/notes/${encodeURIComponent(name)}`;

  it('creates, links, renames, and deletes a note', async () => {
    const created = await call('POST', '/api/notes', { name: 'Atlas: Q4 plan' });
    expect(created.status).toBe(201);
    const { note } = await created.json();
    expect(note.name).toBe('Atlas- Q4 plan');
    expect((await call('POST', '/api/notes', { name: 'atlas- q4 plan' })).status).toBe(409);

    const { card } = await (await call('POST', '/api/cards', { title: 'Linked card' })).json();
    const linked = await (await call('PATCH', `/api/cards/${card.id}`, { refs: [note.name] })).json();
    expect(linked.card.refs).toEqual(['[[Atlas- Q4 plan]]']);
    expect((await (await call('GET', path(note.name))).json()).note.cards).toMatchObject([{ title: 'Linked card' }]);

    const saved = await call('PUT', path(note.name), { text: 'Owners & dates', baseText: '' });
    expect((await saved.json()).note.text).toBe('Owners & dates\n');
    expect((await call('PUT', path(note.name), { text: 'stale', baseText: '' })).status).toBe(409);

    const renamed = await (await call('PATCH', path(note.name), { name: 'Atlas plan' })).json();
    expect(renamed).toMatchObject({ note: { name: 'Atlas plan' }, updated: 1 });
    const board = await (await call('GET', '/api/board')).json();
    expect(board.cards.find((c: { id: string }) => c.id === card.id).refs).toEqual(['[[Atlas plan]]']);
    expect((await (await call('GET', '/api/notes')).json()).notes.map((n: { name: string }) => n.name)).toEqual(['Atlas plan']);

    expect((await call('DELETE', path('Atlas plan'))).status).toBe(200);
    expect((await call('GET', path('Atlas plan'))).status).toBe(404);
    expect((await call('POST', '/api/notes', { name: '///' })).status).toBe(400);
  });
});

describe('search API', () => {
  it('finds new content right away and opens archived cards', async () => {
    await call('POST', '/api/cards', { title: 'Quokka migration plan' });
    await call('POST', '/api/notes', { name: 'Zoo', text: 'The quokka exhibit opens in spring.' });
    const res = await (await call('GET', '/api/search?q=quokka')).json();
    expect(res.results.map((r: { kind: string }) => r.kind).sort()).toEqual(['card', 'reference']);
    expect(typeof res.ms).toBe('number');
    expect((await (await call('GET', '/api/search?q=')).json()).results).toEqual([]);

    const archivedId = 'ARCHIVED1';
    writeFileSync(
      join(tmp, 'Vault', 'archive', 'old.md'),
      `---\nid: ${archivedId}\ntitle: Old quokka task\nstatus: complete\narchived: 2026-10-01T09:00:00-04:00\n---\n## Notes\n`,
    );
    const hit = (await (await call('GET', '/api/search?q=quokka')).json()).results.find((r: { key: string }) => r.key === archivedId);
    expect(hit).toMatchObject({ archived: true });
    expect((await (await call('GET', `/api/cards/${archivedId}`)).json()).card.title).toBe('Old quokka task');
    expect((await call('GET', '/api/cards/nope')).status).toBe(404);
  });
});

describe('intake API', () => {
  it('lists pending proposals, counts them on the board, and applies decisions', async () => {
    const vault = join(tmp, 'Vault');
    writeFileSync(join(vault, 'daily', '2020-03-02.md'), '- need to order badges\n- badges cost too much\n');
    writeFileSync(
      join(vault, 'intake', '2020-03-03-090000.json'),
      JSON.stringify({
        id: '2020-03-03-090000',
        created: '2020-03-03T09:00:00-05:00',
        proposals: [
          { id: 'p1', status: 'pending', type: 'new-task', source: { date: '2020-03-02', quote: 'need to order badges' }, title: 'Order badges', effort: 'low', refs: [] },
          { id: 'p2', status: 'pending', type: 'note-append', source: { date: '2020-03-02', quote: 'badges cost too much' }, note: 'Gone', text: 'x' },
        ],
      }),
    );
    const { items } = await (await call('GET', '/api/intake')).json();
    expect(items).toHaveLength(2);
    expect(items[1].stale).toMatch(/no note named/);
    expect((await (await call('GET', '/api/board')).json()).intakePending).toBe(2);

    const res = await (
      await call('POST', '/api/intake/decide', {
        decisions: [
          { runId: '2020-03-03-090000', id: 'p1', action: 'accept', edits: { effort: 'high' } },
          { runId: '2020-03-03-090000', id: 'p2', action: 'reject' },
        ],
      })
    ).json();
    expect(res.summary).toBe('1 card created, 1 rejected.');
    expect(typeof res.undoId).toBe('string');
    const board = await (await call('GET', '/api/board')).json();
    expect(board.intakePending).toBe(0);
    expect(board.cards.find((c: { title: string }) => c.title === 'Order badges').effort).toBe('high');
    expect((await call('POST', '/api/intake/decide', { decisions: [{ runId: 'x', id: 'p1', action: 'maybe' }] })).status).toBe(400);
  });
});

describe('run /mindscape API', () => {
  it('only the page can start it, and the board counts unprocessed days', async () => {
    writeFileSync(join(tmp, 'Vault', 'daily', '2020-06-01.md'), '- something new\n');
    expect((await (await call('GET', '/api/board')).json()).unprocessedDays).toBeGreaterThan(0);
    expect((await call('POST', '/api/intake/run', {})).status).toBe(403);
    const res = await app.request('/api/intake/run', {
      method: 'POST',
      headers: { host: '127.0.0.1:4317', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ includeToday: true }),
    });
    expect(res.status).toBe(200);
    expect(opened).toEqual([join(tmp, 'settings', 'run-mindscape.command')]);
  });
});
