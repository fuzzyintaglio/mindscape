import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultGit } from '../server/vaultGit.ts';

let tmp: string;
const quiet = () => {};
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mindscape-git-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('vault git history', () => {
  it('creates its own repo and commits changes', async () => {
    const vault = join(tmp, 'Vault');
    mkdirSync(vault);
    writeFileSync(join(vault, 'a.md'), 'one');
    const vg = new VaultGit(vault, 60_000, quiet);
    expect(await vg.init()).toBe(true);
    expect(existsSync(join(vault, '.git'))).toBe(true);
    expect(git(vault, 'log', '--oneline')).toMatch(/start history/);

    writeFileSync(join(vault, 'a.md'), 'two');
    expect(await vg.commitNow('change')).toBe(true);
    expect(await vg.commitNow('nothing new')).toBe(false);
    expect(git(vault, 'log', '-1', '--format=%an <%ae> %s')).toBe('Mindscape <mindscape@localhost> change');
  });

  it('never commits into a parent repo', async () => {
    git(tmp, 'init', '-q');
    const vault = join(tmp, 'Vault');
    mkdirSync(vault);
    writeFileSync(join(vault, 'a.md'), 'x');
    await new VaultGit(vault, 60_000, quiet).init();
    expect(existsSync(join(vault, '.git'))).toBe(true);
    // The parent repo saw no commits from us.
    expect(() => git(tmp, 'log')).toThrow();
  });
});
