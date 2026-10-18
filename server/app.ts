import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { timingSafeEqual } from 'node:crypto';
import { capture } from '../core/capture.ts';
import { isEffort, isStatus } from '../core/cards.ts';
import { THEMES, type Theme, captureToken, ensureConfig, loadConfig, saveConfig } from '../core/config.ts';
import { dailyPath, ensureDaily, ensureDailyTemplate, isDate } from '../core/daily.ts';
import { type Decision, IntakeReview, pendingNotes } from '../core/intake.ts';
import { type WeekStrip, allEvents, currentWeek, summarizeWeek } from '../core/points.ts';
import { listReviews, parseReview, pointsHistory, reviewPath, saveReflection, writeReview } from '../core/reviews.ts';
import { runMindscape } from '../core/runSkill.ts';
import { merge3 } from '../core/merge.ts';
import { type NoteError, NoteStore } from '../core/notes.ts';
import { SearchIndex } from '../core/search.ts';
import { type CardPatch, CardStore } from '../core/store.ts';
import { toLocalDate } from '../core/time.ts';
import { assertVaultOutsideRepo, ensureVault, listVaultFiles } from '../core/vault.ts';
import { APP_VERSION } from '../core/version.ts';
import { EventHub } from './events.ts';
import { localOnly } from './security.ts';

export interface AppOptions {
  vaultPath: string;
  port: number;
  dev: boolean;
  events?: EventHub;
  /** How "Run /mindscape" opens Terminal (tests pass a stand-in). */
  openInTerminal?: (scriptPath: string) => void;
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
  if (body.refs !== undefined) {
    if (!Array.isArray(body.refs) || !body.refs.every((r) => typeof r === 'string')) return 'refs must be a list of note names';
    patch.refs = body.refs as string[];
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

const NOTE_ERRORS: Record<NoteError['reason'], [string, 400 | 404 | 409]> = {
  'not-found': ['note not found', 404],
  exists: ['a note with that name already exists', 409],
  invalid: ['that name has no usable characters', 400],
  conflict: ['changed elsewhere', 409],
};

/** True when `given` is the capture token (compared in constant time). */
function tokenMatches(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Builds the API. Kept separate from index.ts so tests can call it without opening a port. */
export function createApp({ vaultPath, port, dev, events = new EventHub(), openInTerminal }: AppOptions): { app: Hono; store: CardStore; search: SearchIndex } {
  assertVaultOutsideRepo(vaultPath);
  ensureVault(vaultPath);
  ensureConfig(vaultPath);
  const store = new CardStore(vaultPath);
  const files = store.files;
  const notes = new NoteStore(files, store);
  const search = new SearchIndex(files);
  const intake = new IntakeReview(files, store, notes);
  ensureDailyTemplate(files);
  store.ensureWelcome();

  const app = new Hono();
  app.use('*', localOnly(port, dev));

  app.get('/api/health', (c) => c.json({ ok: true, app: 'mindscape', version: APP_VERSION, pid: process.pid }));

  app.get('/api/vault', (c) => c.json({ vaultPath, files: listVaultFiles(vaultPath) }));

  /** This week's points for the header strip, plus the best earlier week. */
  const weekStrip = (rules: ReturnType<typeof loadConfig>): WeekStrip => {
    const all = store.pointsCards();
    const week = summarizeWeek(allEvents(all, rules), currentWeek());
    const best = Math.max(0, ...pointsHistory(all, files, rules).filter((h) => !h.current).map((h) => h.points));
    return { week: week.week, points: week.points, closed: week.closed, days: week.days, best };
  };

  app.get('/api/board', (c) => {
    const { cards, problems } = store.list();
    const config = loadConfig(vaultPath);
    return c.json({
      cards,
      problems,
      config,
      points: weekStrip(config),
      intakePending: intake.pendingCount(),
      // Past daily notes with lines /mindscape hasn't read yet.
      unprocessedDays: pendingNotes(files).length,
    });
  });

  app.post('/api/cards', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.title !== 'string' || !body.title.trim()) return c.json({ error: 'title is required' }, 400);
    if (body.status !== undefined && !isStatus(body.status)) return c.json({ error: 'unknown status' }, 400);
    if (body.effort !== undefined && !isEffort(body.effort)) return c.json({ error: 'unknown effort' }, 400);
    const result = store.create({ title: body.title, status: body.status as never, effort: body.effort as never });
    return c.json(result, 201);
  });

  app.get('/api/cards/:id', (c) => {
    const card = store.getAny(c.req.param('id'));
    return card ? c.json({ card }) : c.json({ error: 'card not found' }, 404);
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

  // Back from the archive onto the board (In Progress).
  app.post('/api/cards/:id/restore', (c) => {
    const result = store.restore(c.req.param('id'));
    return result.ok ? c.json({ card: result.card, undoId: result.undoId }) : c.json({ error: 'archived card not found' }, 404);
  });

  app.get('/api/archive', (c) => c.json(store.archive()));

  app.delete('/api/cards/:id', (c) => {
    const result = store.remove(c.req.param('id'));
    return result.ok ? c.json({ undoId: result.undoId }) : c.json({ error: 'card not found' }, 404);
  });

  app.post('/api/undo/:undoId', (c) => {
    const result = files.undo(c.req.param('undoId'));
    if (result.ok) return c.json({ ok: true });
    const message = result.reason === 'changed' ? 'That changed again since, so it can’t be undone.' : 'Too late to undo that.';
    return c.json({ ok: false, error: message }, 409);
  });

  // ── Daily notes ──────────────────────────────────────
  // Today's note is created the first time it's asked for; other days only with ?create=1.
  app.get('/api/daily/:date', (c) => {
    const date = c.req.param('date');
    if (!isDate(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
    if (date === toLocalDate() || c.req.query('create') === '1') return c.json({ date, text: ensureDaily(files, date).text });
    return c.json({ date, text: files.read(dailyPath(date)) });
  });

  /**
   * Autosave. `base` is the text the editor last got from disk. If the file changed
   * since (a capture from the CLI, an edit in Obsidian), both sets of changes are
   * merged; only overlapping edits come back as a 409 with the file's text.
   */
  app.put('/api/daily/:date', async (c) => {
    const date = c.req.param('date');
    if (!isDate(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
    const body = await jsonBody(c);
    if (typeof body.text !== 'string') return c.json({ error: 'text is required' }, 400);
    const base = typeof body.base === 'string' ? body.base : null;
    const current = files.read(dailyPath(date));
    let next = body.text;
    if (body.force !== true && current !== null && current !== base) {
      const merged = merge3(base ?? '', body.text, current);
      if (!merged.ok) return c.json({ error: 'changed elsewhere', text: current }, 409);
      next = merged.text;
    }
    if (next !== current) files.write(dailyPath(date), next);
    return c.json({ date, text: next });
  });

  // ── Quick Capture ────────────────────────────────────
  // The page calls this directly; anything else (CLI, macOS Shortcut) must send the token.
  app.post('/api/capture', async (c) => {
    const fromPage = c.req.header('sec-fetch-site') === 'same-origin';
    const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!fromPage && !tokenMatches(auth, captureToken(vaultPath))) return c.json({ error: 'capture token required' }, 401);
    const body = await jsonBody(c);
    if (typeof body.text !== 'string' || !body.text.trim()) return c.json({ error: 'text is required' }, 400);
    return c.json(capture(store, body.text), 201);
  });

  // ── Reference notes ──────────────────────────────────
  const noteError = (c: { json: (b: unknown, s: number) => Response }, e: NoteError) => {
    const [error, status] = NOTE_ERRORS[e.reason];
    return c.json({ error, note: e.note }, status);
  };

  app.get('/api/notes', (c) => c.json({ notes: notes.list() }));

  app.get('/api/notes/:name', (c) => {
    const note = notes.get(c.req.param('name'));
    return note ? c.json({ note }) : c.json({ error: 'note not found' }, 404);
  });

  app.post('/api/notes', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.name !== 'string') return c.json({ error: 'name is required' }, 400);
    const result = notes.create(body.name, typeof body.text === 'string' ? body.text : '');
    return result.ok ? c.json({ note: result.note, undoId: result.undoId }, 201) : noteError(c, result);
  });

  app.put('/api/notes/:name', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.text !== 'string') return c.json({ error: 'text is required' }, 400);
    const result = notes.save(c.req.param('name'), body.text, typeof body.baseText === 'string' ? body.baseText : undefined);
    return result.ok ? c.json({ note: result.note }) : noteError(c, result);
  });

  app.patch('/api/notes/:name', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.name !== 'string') return c.json({ error: 'name is required' }, 400);
    const result = notes.rename(c.req.param('name'), body.name);
    return result.ok ? c.json({ note: result.note, undoId: result.undoId, updated: result.updated }) : noteError(c, result);
  });

  app.delete('/api/notes/:name', (c) => {
    const result = notes.remove(c.req.param('name'));
    return result.ok ? c.json({ undoId: result.undoId }) : noteError(c, result);
  });

  // ── Intake review ────────────────────────────────────
  app.get('/api/intake', (c) => c.json({ items: intake.list() }));

  // Opens Terminal with a Claude Code session running /mindscape. Only Mindscape's own page may ask.
  app.post('/api/intake/run', async (c) => {
    if (c.req.header('sec-fetch-site') !== 'same-origin') return c.json({ error: 'only from the Mindscape page' }, 403);
    const body = await jsonBody(c);
    const result = runMindscape(vaultPath, body.includeToday === true, openInTerminal);
    return result.ok ? c.json(result) : c.json({ error: result.error }, 409);
  });

  app.post('/api/intake/decide', async (c) => {
    const body = await jsonBody(c);
    const decisions = body.decisions;
    const valid =
      Array.isArray(decisions) &&
      decisions.every(
        (d) =>
          d && typeof d === 'object' && typeof d.runId === 'string' && typeof d.id === 'string' && (d.action === 'accept' || d.action === 'reject') &&
          (d.edits === undefined || (typeof d.edits === 'object' && d.edits !== null && !Array.isArray(d.edits))),
      );
    if (!valid) return c.json({ error: 'decisions must be a list of {runId, id, action: accept|reject, edits?}' }, 400);
    return c.json(intake.decide(decisions as Decision[]));
  });

  // ── Weekly reviews ───────────────────────────────────
  const reviewContext = () => ({ vault: vaultPath, files, store, rules: loadConfig(vaultPath) });

  app.get('/api/reviews', (c) => {
    const config = loadConfig(vaultPath);
    return c.json({ reviews: listReviews(files), history: pointsHistory(store.pointsCards(), files, config) });
  });

  app.get('/api/reviews/:week', (c) => {
    const week = c.req.param('week');
    const text = files.read(reviewPath(week));
    const parsed = text ? parseReview(text) : null;
    if (!parsed) return c.json({ error: 'no review for that week' }, 404);
    return c.json({ review: { ...parsed.meta, body: parsed.body, reflection: parsed.reflection } });
  });

  app.post('/api/reviews/:week', (c) => {
    const result = writeReview(reviewContext(), c.req.param('week'));
    return result.ok ? c.json(result, 201) : c.json({ error: result.error }, 400);
  });

  app.put('/api/reviews/:week/reflection', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.text !== 'string') return c.json({ error: 'text is required' }, 400);
    const result = saveReflection(files, c.req.param('week'), body.text, typeof body.base === 'string' ? body.base : undefined);
    if (result.ok) return c.json(result);
    return result.reason === 'conflict'
      ? c.json({ error: 'changed elsewhere', reflection: result.reflection }, 409)
      : c.json({ error: 'no review for that week' }, 404);
  });

  // ── Search ───────────────────────────────────────────
  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').slice(0, 200);
    const started = performance.now();
    const results = search.search(q);
    return c.json({ q, results, ms: Math.round(performance.now() - started) });
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

  return { app, store, search };
}
