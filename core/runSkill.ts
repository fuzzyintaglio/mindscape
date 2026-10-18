// "Run /mindscape" in the app: opens a normal, visible Claude Code session in
// Terminal that starts with /mindscape. Not headless — it's the same session you'd
// start by hand, so you can watch it and answer any permission questions.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { installSkill, skillStatus } from './claudeSkill.ts';
import { settingsDir } from './settings.ts';

/** Where `claude` is: on PATH, or one of the usual install spots. Null means "let the shell find it". */
export function findClaude(path = process.env.PATH ?? ''): string | null {
  const home = homedir();
  const candidates = [
    ...path.split(delimiter).filter(Boolean).map((dir) => join(dir, 'claude')),
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The script Terminal runs. Fixed content: only the vault path and Claude's location vary. */
export function runScript(vaultPath: string, claude: string | null, includeToday: boolean): string {
  const prompt = includeToday ? '/mindscape include today' : '/mindscape';
  return `#!/bin/bash
# Written by Mindscape for its "Run /mindscape" button. Safe to delete.
cd ${shellQuote(vaultPath)} || exit 1
CLAUDE=${claude ? shellQuote(claude) : 'claude'}
if ! command -v "$CLAUDE" >/dev/null 2>&1; then
  echo "Couldn't find Claude Code (the 'claude' command)."
  echo "Open a new Terminal window, check that 'claude' works there, then try the button again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
exec "$CLAUDE" ${shellQuote(prompt)}
`;
}

export type RunResult = { ok: true; skill: 'installed' | 'current' } | { ok: false; error: string };

/**
 * Make sure the skill is installed and current, then open Terminal on the run script.
 * `open` is swappable so tests never launch anything.
 */
export function runMindscape(
  vaultPath: string,
  includeToday: boolean,
  open: (scriptPath: string) => void = (p) => spawn('/usr/bin/open', ['-a', 'Terminal', p], { detached: true, stdio: 'ignore' }).unref(),
): RunResult {
  const status = skillStatus(vaultPath);
  if (status === 'foreign') return { ok: false, error: 'Another /mindscape skill is installed that Mindscape didn’t write, so it was left alone.' };
  if (status !== 'current') installSkill(vaultPath);
  const dir = settingsDir();
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'run-mindscape.command');
  writeFileSync(script, runScript(vaultPath, findClaude(), includeToday));
  chmodSync(script, 0o755);
  open(script);
  return { ok: true, skill: status === 'current' ? 'current' : 'installed' };
}
