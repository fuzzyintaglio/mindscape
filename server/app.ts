import { Hono } from 'hono';
import { assertVaultOutsideRepo, ensureVault, listVaultFiles } from '../core/vault.ts';
import { APP_VERSION } from '../core/version.ts';
import { localOnly } from './security.ts';

export interface AppOptions {
  vaultPath: string;
  port: number;
  dev: boolean;
}

/** Builds the API. Kept separate from index.ts so tests can call it without opening a port. */
export function createApp({ vaultPath, port, dev }: AppOptions): Hono {
  assertVaultOutsideRepo(vaultPath);
  ensureVault(vaultPath);

  const app = new Hono();
  app.use('*', localOnly(port, dev));

  app.get('/api/health', (c) => c.json({ ok: true, app: 'mindscape', version: APP_VERSION, pid: process.pid }));

  app.get('/api/vault', (c) => c.json({ vaultPath, files: listVaultFiles(vaultPath) }));

  return app;
}
