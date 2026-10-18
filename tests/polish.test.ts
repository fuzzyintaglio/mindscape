// Phase 6: the vault .zip export and the launcher's one-click update.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { vaultEntries } from '../core/exportVault.ts';
import { updateRepo } from '../core/update.ts';
import { createZip, crc32 } from '../core/zip.ts';
import { createApp } from '../server/app.ts';

const tmp = mkdtempSync(join(tmpdir(), 'mindscape-polish-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const unzip = (args: string[]) => execFileSync('unzip', args, { encoding: 'utf8' });

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('writes a file that unzip accepts, with UTF-8 names, compressed and stored entries', () => {
    const file = join(tmp, 'test.zip');
    const big = Buffer.from('hello world\n'.repeat(500));
    writeFileSync(
      file,
      createZip([
        { name: 'V/notes/Café ☕.md', data: Buffer.from('ünïcode'), modified: new Date(2026, 9, 18, 9, 30, 12) },
        { name: 'V/big.txt', data: big, modified: new Date(2026, 9, 18) },
        { name: 'V/empty.md', data: Buffer.alloc(0), modified: new Date(1970, 0, 1) },
      ]),
    );
    expect(unzip(['-t', file])).toContain('No errors detected');
    expect(unzip(['-p', file, 'V/notes/Café ☕.md'])).toBe('ünïcode');
    expect(unzip(['-p', file, 'V/big.txt'])).toBe(big.toString());
    // Finder's double-click unzip (ditto) gets the names right too.
    const out = join(tmp, 'ditto');
    execFileSync('ditto', ['-x', '-k', file, out]);
    expect(readdirSync(join(out, 'V', 'notes'))).toEqual(['Café ☕.md']);
    expect(readFileSync(join(out, 'V', 'empty.md'), 'utf8')).toBe('');
  });
});

describe('Export vault as .zip', () => {
  const vault = join(tmp, 'My Vault');
  process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
  process.env.MINDSCAPE_SETTINGS_DIR = join(tmp, 'settings');
  const { app } = createApp({ vaultPath: vault, port: 4317, dev: false });
  mkdirSync(join(vault, '.git'), { recursive: true });
  writeFileSync(join(vault, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(vault, 'reference', 'Atlas.md'), '# Atlas\n');
  writeFileSync(join(vault, 'reference', '.Atlas.md.tmp-123'), 'half-written');
  writeFileSync(join(vault, '.DS_Store'), 'x');
  const config = JSON.parse(readFileSync(join(vault, '.mindscape', 'config.json'), 'utf8'));
  writeFileSync(join(vault, '.mindscape', 'config.json'), JSON.stringify({ ...config, captureToken: 'secret-token-123456789' }));

  it('includes every vault file inside a folder named after the vault, and leaves out git, clutter, and the token', () => {
    const names = vaultEntries(vault).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['My Vault/reference/Atlas.md', 'My Vault/templates/daily.md', 'My Vault/.mindscape/config.json']));
    expect(names.some((n) => n.startsWith('My Vault/tasks/'))).toBe(true); // the welcome card
    expect(names.filter((n) => /\.git\/|DS_Store|tmp-/.test(n))).toEqual([]);
    const cfg = vaultEntries(vault).find((e) => e.name.endsWith('config.json'))!;
    expect(cfg.data.toString()).not.toContain('secret-token');
    expect(JSON.parse(cfg.data.toString()).points.high).toBe(750);
  });

  it('downloads from the page only, as a .zip that unzips to the vault', async () => {
    const headers = { host: '127.0.0.1:4317' };
    expect((await app.request('/api/export', { headers })).status).toBe(403);
    const res = await app.request('/api/export', { headers: { ...headers, 'sec-fetch-site': 'same-origin' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="My Vault \d{4}-\d{2}-\d{2}\.zip"/);
    const file = join(tmp, 'export.zip');
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    expect(unzip(['-t', file])).toContain('No errors detected');
    const out = join(tmp, 'unzipped');
    unzip(['-q', file, '-d', out]);
    expect(readFileSync(join(out, 'My Vault', 'reference', 'Atlas.md'), 'utf8')).toBe('# Atlas\n');
  });
});

describe('one-click update', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const remote = join(tmp, 'remote.git');
  const dev = join(tmp, 'dev');
  const work = join(tmp, 'work');
  const commit = (repo: string, file: string, text: string) => {
    writeFileSync(join(repo, file), text);
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', `edit ${file}`);
  };

  it('fast-forwards to what was pushed, and says when it’s current', () => {
    mkdirSync(remote);
    git(remote, 'init', '-q', '--bare');
    mkdirSync(dev);
    git(dev, 'init', '-q');
    commit(dev, 'a.txt', 'one');
    git(dev, 'remote', 'add', 'origin', remote);
    git(dev, 'push', '-q', '-u', 'origin', 'main');
    execFileSync('git', ['clone', '-q', remote, work]);

    expect(updateRepo(work)).toEqual({ status: 'current' });
    commit(dev, 'a.txt', 'two');
    commit(dev, 'b.txt', 'three');
    git(dev, 'push', '-q');
    expect(updateRepo(work)).toMatchObject({ status: 'updated', commits: 2 });
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('two');
    expect(updateRepo(work)).toEqual({ status: 'current' });
  });

  it('never touches hand-made changes', () => {
    commit(dev, 'a.txt', 'four');
    git(dev, 'push', '-q');
    writeFileSync(join(work, 'a.txt'), 'edited by hand');
    expect(updateRepo(work)).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/changed by hand/) });
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('edited by hand');
    git(work, 'checkout', '--', 'a.txt');
    writeFileSync(join(work, 'untracked.txt'), 'fine'); // untracked files don't block an update
    expect(updateRepo(work)).toMatchObject({ status: 'updated', commits: 1 });
  });

  it('treats a copy that is ahead as current, and a diverged one as skipped', () => {
    commit(work, 'local.txt', 'mine');
    expect(updateRepo(work)).toEqual({ status: 'current' });
    commit(dev, 'a.txt', 'five');
    git(dev, 'push', '-q');
    expect(updateRepo(work)).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/commits GitHub doesn’t/) });
  });

  it('starts what it has when GitHub can’t be reached, or there is no git at all', () => {
    git(work, 'remote', 'set-url', 'origin', join(tmp, 'gone.git'));
    expect(updateRepo(work)).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/Couldn’t reach/) });
    const plain = join(tmp, 'plain');
    mkdirSync(plain);
    expect(updateRepo(plain)).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/isn’t a git checkout/) });
  });
});
