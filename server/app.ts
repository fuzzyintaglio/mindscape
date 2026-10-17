import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { isEffort, isStatus } from '../core/cards.ts';
import { THEMES, type Theme, ensureConfig, loadConfig, saveConfig } from '../core/config.ts';
import { type CardPatch, CardStore } from '../core/store.ts';
import { assertVaultOutsideRepo, ensureVault, listVaultFiles } from '../core/vault.ts';
import { APP_VERSION } from '../core/version.ts';
import { EventHub } from './events.ts';
import { localOnly } from './security.ts';

export interface AppOptions {
  vaultPath: string;
  port: number;
  dev: boolean;
  events?: EventHub;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a PATCH body into a CardPatch, or return an error message. */
function parsePatch(body: Record<string, unknown>): CardPatch | string {
  const patch: CardPatch = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return 'title must be non-empty text';
    patch.title = body.title;
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return 'unknown status';
    patch.status = body.status;
  }
  if (body.effort !== undefined) {
    if (!isEffort(body.effort)) return 'unknown effort';
    patch.effort = body.effort;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return 'notes must be text';
    patch.notes = body.notes;
  }
  if (body.baseNotes !== undefined) {
    if (typeof body.baseNotes !== 'string') return 'baseNotes must be text';
    patch.baseNotes = body.baseNotes;
  }
  if (body.blockedBy !== undefined) {
    if (body.blockedBy !== null && typeof body.blockedBy !== 'string') return 'blockedBy must be text';
    patch.blockedBy = body.blockedBy as string | null;
  }
  if (body.unblockBy !== undefined) {
    if (body.unblockBy !== null && body.unblockBy !== '' && !(typeof body.unblockBy === 'string' && DATE.test(body.unblockBy)))
      return 'unblockBy must be a YYYY-MM-DD date';
    patch.unblockBy = (body.unblockBy as string | null) || null;
  }
  return patch;
}

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Builds the API. Kept separate from index.ts so tests can call it without opening a port. */
export function createApp({ vaultPath, port, dev, events = new EventHub() }: AppOptions): { app: Hono; store: CardStore } {
  assertVaultOutsideRepo(vaultPath);
  ensureVault(vaultPath);
  ensureConfig(vaultPath);
  const store = new CardStore(vaultPath);
  store.ensureWelcome();

  const app = new Hono();
  app.use('*', localOnly(port, dev));

  app.get('/api/health', (c) => c.json({ ok: true, app: 'mindscape', version: APP_VERSION, pid: process.pid }));

  app.get('/api/vault', (c) => c.json({ vaultPath, files: listVaultFiles(vaultPath) }));

  app.get('/api/board', (c) => {
    const { cards, problems } = store.list();
    return c.json({ cards, problems, config: loadConfig(vaultPath) });
  });

  app.post('/api/cards', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.title !== 'string' || !body.title.trim()) return c.json({ error: 'title is required' }, 400);
    if (body.status !== undefined && !isStatus(body.status)) return c.json({ error: 'unknown status' }, 400);
    if (body.effort !== undefined && !isEffort(body.effort)) return c.json({ error: 'unknown effort' }, 400);
    const result = store.create({ title: body.title, status: body.status as never, effort: body.effort as never });
    return c.json(result, 201);
  });

  app.patch('/api/cards/:id', async (c) => {
    const body = await jsonBody(c);
    const patch = parsePatch(body);
    if (typeof patch === 'string') return c.json({ error: patch }, 400);
    const rev = typeof body.rev === 'string' ? body.rev : undefined;
    const result = store.update(c.req.param('id'), patch, rev);
    if (result.ok) return c.json({ card: result.card, undoId: result.undoId });
    if (result.reason === 'conflict') return c.json({ error: 'changed elsewhere', card: result.card }, 409);
    return c.json({ error: 'card not found' }, 404);
  });

  app.delete('/api/cards/:id', (c) => {
    const result = store.remove(c.req.param('id'));
    return result.ok ? c.json({ undoId: result.undoId }) : c.json({ error: 'card not found' }, 404);
  });

  app.post('/api/undo/:undoId', (c) => {
    const result = store.undo(c.req.param('undoId'));
    if (result.ok) return c.json({ ok: true });
    const message = result.reason === 'changed' ? 'That card changed since, so it can’t be undone.' : 'Too late to undo that.';
    return c.json({ ok: false, error: message }, 409);
  });

  app.get('/api/config', (c) => c.json(loadConfig(vaultPath)));

  app.patch('/api/config', async (c) => {
    const body = await jsonBody(c);
    if (body.theme !== undefined && !THEMES.includes(body.theme as Theme)) return c.json({ error: 'unknown theme' }, 400);
    return c.json(saveConfig(vaultPath, body.theme !== undefined ? { theme: body.theme as Theme } : {}));
  });

  // Live updates: the page refreshes whenever anything in the vault changes.
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = events.subscribe((event) => void stream.writeSSE({ event, data: '' }));
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: 'hello', data: '' });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: 'ping', data: '' });
      }
      unsubscribe();
    }),
  );

  return { app, store };
}
