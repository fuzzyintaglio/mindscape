// Git auto-save for the vault: its own local repo (never pushed), committed a
// little while after changes stop, giving undo history for every card and note.
import { execFile } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Commits are attributed to the app, so no git identity is needed on the machine.
const AUTHOR = ['-c', 'user.name=Mindscape', '-c', 'user.email=mindscape@localhost'];

export class VaultGit {
  private timer: NodeJS.Timeout | undefined;
  private disabled = false;

  constructor(
    private vault: string,
    private delayMs = 2 * 60 * 1000,
    private log: (...args: unknown[]) => void = console.log,
  ) {}

  private git(...args: string[]) {
    return run('git', ['-C', this.vault, ...AUTHOR, ...args], { timeout: 30_000 });
  }

  /** Make sure the vault has its own repo. Checks for <vault>/.git directly so we never commit into a parent repo. */
  async init(): Promise<boolean> {
    try {
      if (!existsSync(join(this.vault, '.git'))) {
        await this.git('init', '-q');
        const ignore = join(this.vault, '.gitignore');
        if (!existsSync(ignore)) writeFileSync(ignore, '.DS_Store\n.*.tmp-*\n');
        await this.commitNow('Mindscape: start history');
        this.log('Vault history: created a local git repo in the vault');
      }
      const { stdout } = await this.git('remote');
      if (stdout.trim()) this.log(`Vault history: note — the vault repo has a remote (${stdout.trim()}). Mindscape never pushes.`);
      return true;
    } catch (err) {
      this.disabled = true;
      this.log(`Vault history disabled: ${(err as Error).message.split('\n')[0]}`);
      return false;
    }
  }

  /** Call on every change; commits once things have been quiet for `delayMs`. */
  schedule() {
    if (this.disabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.commitNow(), this.delayMs);
  }

  async commitNow(message = `Mindscape auto-save ${new Date().toLocaleString()}`): Promise<boolean> {
    if (this.disabled) return false;
    clearTimeout(this.timer);
    try {
      const { stdout } = await this.git('status', '--porcelain');
      if (!stdout.trim()) return false;
      await this.git('add', '-A');
      await this.git('commit', '-q', '-m', message);
      return true;
    } catch (err) {
      this.log(`Vault history: commit failed — ${(err as Error).message.split('\n')[0]}`);
      return false;
    }
  }
}
