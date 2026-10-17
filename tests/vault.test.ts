import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertVaultOutsideRepo, ensureVault, listVaultFiles, REPO_ROOT, VAULT_FOLDERS } from '../core/vault.ts';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mindscape-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('assertVaultOutsideRepo', () => {
  it('accepts a vault outside the repo', () => {
    expect(() => assertVaultOutsideRepo(join(tmp, 'Vault'))).not.toThrow();
  });

  it('refuses a vault inside the repo, even one that does not exist yet', () => {
    expect(() => assertVaultOutsideRepo(join(REPO_ROOT, 'My Vault'))).toThrow(/inside the code repo/);
    expect(() => assertVaultOutsideRepo(REPO_ROOT)).toThrow(/inside the code repo/);
  });

  it('refuses a vault that contains the repo', () => {
    const repo = join(tmp, 'vault', 'code');
    mkdirSync(repo, { recursive: true });
    expect(() => assertVaultOutsideRepo(join(tmp, 'vault'), repo)).toThrow(/contains the code repo/);
  });

  it('does not confuse sibling folders with a shared prefix', () => {
    const repo = join(tmp, 'Mindscape');
    mkdirSync(repo);
    expect(() => assertVaultOutsideRepo(join(tmp, 'Mindscape Vault'), repo)).not.toThrow();
  });
});

describe('ensureVault', () => {
  it('creates every folder and is safe to run twice', () => {
    const vault = join(tmp, 'Vault');
    const first = ensureVault(vault);
    expect(first.created).toEqual(['.', ...VAULT_FOLDERS]);
    expect(ensureVault(vault).created).toEqual([]);
  });

  it('never touches existing files', () => {
    const vault = join(tmp, 'Vault');
    mkdirSync(join(vault, 'daily'), { recursive: true });
    writeFileSync(join(vault, 'daily', '2026-10-17.md'), 'keep me');
    ensureVault(vault);
    expect(listVaultFiles(vault).map((f) => f.path)).toEqual(['daily/2026-10-17.md']);
  });
});

describe('listVaultFiles', () => {
  it('lists files with forward-slash paths and skips hidden folders', () => {
    const vault = join(tmp, 'Vault');
    ensureVault(vault);
    writeFileSync(join(vault, 'reference', 'Project Alpha.md'), '# hi');
    writeFileSync(join(vault, '.trash', 'gone.md'), 'x');
    writeFileSync(join(vault, '.mindscape', 'config.json'), '{}');
    expect(listVaultFiles(vault).map((f) => f.path)).toEqual(['reference/Project Alpha.md']);
  });
});
