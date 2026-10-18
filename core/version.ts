import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './vault.ts';

// Inlined by esbuild in release builds; read from package.json when running from source.
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

/** True when running the prebuilt release/ bundle rather than source via tsx. */
export const BUNDLED = process.env.MINDSCAPE_BUNDLED === '1';

export const MIN_NODE_MAJOR = 20;

export function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0]);
}

/** Which build is running: the release fingerprint and, if the repo is a git checkout, its commit. */
export function buildInfo(): { builtAt: string | null; commit: string | null; commitDate: string | null } {
  let builtAt: string | null = null;
  const build = join(REPO_ROOT, 'release', 'BUILD.json');
  if (existsSync(build)) {
    try {
      builtAt = (JSON.parse(readFileSync(build, 'utf8')) as { builtAt?: string }).builtAt ?? null;
    } catch {
      // a broken BUILD.json just means "unknown"
    }
  }
  try {
    const [commit, commitDate] = execFileSync('git', ['-C', REPO_ROOT, 'log', '-1', '--format=%h%n%cI'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .trim()
      .split('\n');
    return { builtAt, commit: commit || null, commitDate: commitDate || null };
  } catch {
    return { builtAt, commit: null, commitDate: null };
  }
}
