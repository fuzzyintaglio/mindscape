// One-click update: the launcher runs this before starting. The release is
// prebuilt and committed, so an update is just a fast-forward `git pull`. It never
// touches local changes, never merges, and never asks for a password; anything
// unusual means "skip and start the version you have".
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { REPO_ROOT } from './vault.ts';

export type UpdateResult =
  | { status: 'updated'; from: string; to: string; commits: number }
  | { status: 'current' }
  | { status: 'skipped'; reason: string };

export function updateRepo(repo: string = REPO_ROOT, fetchTimeoutMs = 15_000): UpdateResult {
  const git = (args: string[], timeout = 10_000) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  const ok = (args: string[]) => {
    try {
      git(args);
      return true;
    } catch {
      return false;
    }
  };

  let top: string;
  try {
    top = git(['rev-parse', '--show-toplevel']);
  } catch {
    return { status: 'skipped', reason: 'This folder isn’t a git checkout.' };
  }
  if (realpathSync(top) !== realpathSync(repo)) return { status: 'skipped', reason: 'This folder isn’t a git checkout.' };
  if (!ok(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])) return { status: 'skipped', reason: 'This branch doesn’t track a remote branch.' };
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    return { status: 'skipped', reason: 'Files in this folder were changed by hand, so it didn’t update. (git status shows them.)' };
  }
  try {
    git(['fetch', '--quiet'], fetchTimeoutMs);
  } catch {
    return { status: 'skipped', reason: 'Couldn’t reach GitHub to check for updates.' };
  }
  const from = git(['rev-parse', 'HEAD']);
  const to = git(['rev-parse', '@{u}']);
  if (from === to || ok(['merge-base', '--is-ancestor', '@{u}', 'HEAD'])) return { status: 'current' };
  if (!ok(['merge-base', '--is-ancestor', 'HEAD', '@{u}'])) {
    return { status: 'skipped', reason: 'This copy has commits GitHub doesn’t, so it didn’t update.' };
  }
  const commits = Number(git(['rev-list', '--count', 'HEAD..@{u}']));
  git(['merge', '--ff-only', '--quiet', '@{u}'], 60_000);
  return { status: 'updated', from: from.slice(0, 7), to: to.slice(0, 7), commits };
}
