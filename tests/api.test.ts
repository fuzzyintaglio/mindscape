import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';

const tmp = mkdtempSync(join(tmpdir(), 'mindscape-api-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const { app } = createApp({ vaultPath: join(tmp, 'Vault'), port: 4317, dev: false });
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
    expect((await call('PATCH', '/api/cards/missing', { title: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/api/config', { theme: 'neon' })).status).toBe(400);
  });

  it('saves the theme in the vault config', async () => {
    expect((await (await call('PATCH', '/api/config', { theme: 'dark' })).json()).theme).toBe('dark');
    expect((await (await call('GET', '/api/config')).json()).theme).toBe('dark');
  });
});
