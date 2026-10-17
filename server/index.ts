import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadSettings, pidFile } from '../core/settings.ts';
import { REPO_ROOT } from '../core/vault.ts';
import { BUNDLED, MIN_NODE_MAJOR, nodeMajor } from '../core/version.ts';
import { createApp } from './app.ts';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

if (nodeMajor() < MIN_NODE_MAJOR) {
  console.error(`Mindscape needs Node ${MIN_NODE_MAJOR}+; this is ${process.version}.`);
  process.exit(1);
}

// serveStatic resolves paths against the working directory.
process.chdir(REPO_ROOT);

const dev = process.env.MINDSCAPE_DEV === '1';
const { vaultPath, port } = loadSettings();

let app;
try {
  app = createApp({ vaultPath, port, dev });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

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

const shutdown = () => {
  log('Shutting down');
  rmSync(pid, { force: true });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
