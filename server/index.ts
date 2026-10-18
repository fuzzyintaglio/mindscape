import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadConfig } from '../core/config.ts';
import { loadSettings, pidFile } from '../core/settings.ts';
import { REPO_ROOT } from '../core/vault.ts';
import { BUNDLED, MIN_NODE_MAJOR, nodeMajor } from '../core/version.ts';
import { createApp } from './app.ts';
import { EventHub } from './events.ts';
import { VaultGit } from './vaultGit.ts';
import { watchVault } from './watcher.ts';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

if (nodeMajor() < MIN_NODE_MAJOR) {
  console.error(`Mindscape needs Node ${MIN_NODE_MAJOR}+; this is ${process.version}.`);
  process.exit(1);
}

// serveStatic resolves paths against the working directory.
process.chdir(REPO_ROOT);

const dev = process.env.MINDSCAPE_DEV === '1';
const { vaultPath, port } = loadSettings();
const events = new EventHub();

let built: ReturnType<typeof createApp>;
try {
  built = createApp({ vaultPath, port, dev, events });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const { app, store, search } = built;

if (!dev) {
  // The prebuilt bundle ships its UI in release/ui; running from source uses the Vite build in dist/ui.
  const uiDir = BUNDLED ? 'release/ui' : 'dist/ui';
  if (!existsSync(join(REPO_ROOT, uiDir, 'index.html'))) {
    console.error(BUNDLED ? `Release is incomplete: ${uiDir} is missing. Run: git pull` : 'UI is not built yet. Run: npm run build');
    process.exit(1);
  }
  app.use('/*', serveStatic({ root: `./${uiDir}` }));
  // Single-page app: any other path gets index.html.
  app.get('*', serveStatic({ path: `./${uiDir}/index.html` }));
}

// Background jobs: live reload, git history, auto-archive.
const git = new VaultGit(vaultPath, 2 * 60 * 1000, log);
await git.init();

// Build the search index in the background so the first search is instant.
setTimeout(() => log(`Search index: ${search.refresh()} files`), 0);

const watcher = watchVault(vaultPath, () => {
  search.refresh(); // so a search that follows the change sees it
  events.emit('vault-changed');
  git.schedule();
});

const archive = () => {
  try {
    const moved = store.archiveDue(loadConfig(vaultPath).archiveAfterDays);
    if (moved) log(`Archived ${moved} completed card(s)`);
  } catch (err) {
    log('Auto-archive failed:', (err as Error).message);
  }
};
archive();
const archiveTimer = setInterval(archive, 60 * 60 * 1000);

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  log(`Mindscape ${dev ? '(dev) ' : ''}listening on http://127.0.0.1:${port}`);
  log(`Vault: ${vaultPath}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Is Mindscape already running?`);
  else console.error(err);
  process.exit(1);
});

const pid = pidFile();
mkdirSync(dirname(pid), { recursive: true });
writeFileSync(pid, String(process.pid));

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down');
  clearInterval(archiveTimer);
  watcher.close();
  await git.commitNow('Mindscape auto-save on quit');
  rmSync(pid, { force: true });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', () => log('Ignoring SIGHUP (terminal closed); still running'));

// Leave a trace in the log for any exit we didn't ask for.
process.on('uncaughtException', (err) => {
  log('Crashed:', err.stack ?? err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => log('Unhandled error:', err));
process.on('exit', (code) => {
  if (!shuttingDown) log(`Exited unexpectedly (code ${code})`);
});
