import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';

const tmp = mkdtempSync(join(tmpdir(), 'mindscape-sec-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const app = createApp({ vaultPath: join(tmp, 'Vault'), port: 4317, dev: false });
const get = (headers: Record<string, string>) => app.request('/api/health', { headers });

describe('local-only requests', () => {
  it('allows our own page', async () => {
    expect((await get({ host: '127.0.0.1:4317' })).status).toBe(200);
    expect((await get({ host: 'localhost:4317', origin: 'http://localhost:4317' })).status).toBe(200);
  });

  it('allows tools with no Origin header (CLI, Shortcuts)', async () => {
    expect((await get({ host: '127.0.0.1:4317' })).status).toBe(200);
  });

  it('blocks a different Host (DNS rebinding)', async () => {
    expect((await get({ host: 'evil.example:4317' })).status).toBe(403);
  });

  it('blocks requests from other websites', async () => {
    expect((await get({ host: '127.0.0.1:4317', origin: 'https://evil.example' })).status).toBe(403);
    expect((await get({ host: '127.0.0.1:4317', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('does not allow the dev UI origin outside dev mode', async () => {
    expect((await get({ host: '127.0.0.1:5317' })).status).toBe(403);
  });
});
