import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const VAULT_FOLDERS = [
  'tasks',
  'archive',
  'reference',
  'daily',
  'reviews',
  'intake',
  'templates',
  '.trash',
  '.mindscape',
] as const;

export interface VaultFile {
  path: string; // relative to the vault root, always with forward slashes
  size: number;
  modified: string; // ISO timestamp
}

/** Resolve symlinks for the deepest part of `p` that exists, so not-yet-created paths compare correctly. */
function realish(p: string): string {
  let current = resolve(p);
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    rest.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  return join(realpathSync(current), ...rest);
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Work notes must never end up on GitHub, so refuse any vault that sits inside
 * the code repo (or a repo that sits inside the vault).
 */
export function assertVaultOutsideRepo(vaultPath: string, repoRoot: string = REPO_ROOT): void {
  const vault = realish(vaultPath);
  const repo = realish(repoRoot);
  if (isInside(vault, repo)) {
    throw new Error(
      `Refusing to use a vault inside the code repo.\n  vault: ${vault}\n  repo:  ${repo}\n` +
        `Move the vault elsewhere, e.g. ~/Desktop/Mindscape Vault, and run: npm run setup -- --vault "<path>"`,
    );
  }
  if (isInside(repo, vault)) {
    throw new Error(`Refusing to use a vault that contains the code repo.\n  vault: ${vault}\n  repo:  ${repo}`);
  }
}

/** Create the vault folder structure if it's missing. Never touches existing files. */
export function ensureVault(vaultPath: string): { created: string[] } {
  const created: string[] = [];
  if (!existsSync(vaultPath)) {
    mkdirSync(vaultPath, { recursive: true });
    created.push('.');
  }
  for (const folder of VAULT_FOLDERS) {
    const p = join(vaultPath, folder);
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
      created.push(folder);
    }
  }
  return { created };
}

/** List the user-visible files in the vault. Hidden folders (.git, .trash, .mindscape) are skipped. */
export function listVaultFiles(vaultPath: string): VaultFile[] {
  const out: VaultFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const s = statSync(full);
        out.push({
          path: relative(vaultPath, full).split(sep).join('/'),
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      }
    }
  };
  if (existsSync(vaultPath)) walk(vaultPath);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
