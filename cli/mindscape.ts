import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sourceHash } from '../scripts/source-hash.mjs';
import { type CaptureResult, capture as captureLocally } from '../core/capture.ts';
import { captureToken } from '../core/config.ts';
import { ensureDailyTemplate } from '../core/daily.ts';
import { CardStore } from '../core/store.ts';
import { updateRepo } from '../core/update.ts';
import { expandHome, loadSettings, logDir, pidFile, saveSettings, settingsFile } from '../core/settings.ts';
import { assertVaultOutsideRepo, ensureVault, listVaultFiles, REPO_ROOT } from '../core/vault.ts';
import { APP_VERSION, MIN_NODE_MAJOR, nodeMajor } from '../core/version.ts';
import { installSkill, skillPath, skillStatus } from '../core/claudeSkill.ts';
import { intake, printBriefing, printIndex, review, today } from './vaultCommands.ts';

const USAGE = `mindscape ${APP_VERSION}

Usage:
  mindscape "call about timelines"   Capture a line into today's daily note ("t: …" makes a card; t! High, t- Low)
  mindscape capture <text>           The same, for a single word
  mindscape token                    Print the capture token (for a macOS Shortcut)
  mindscape setup [--vault <path>]   Save this machine's vault location, create the vault folders,
                                     and install the /mindscape skill for Claude Code
  mindscape install-skill            Reinstall the /mindscape skill (after a git pull changed it)
  mindscape doctor                   Check Node, settings, vault, and whether the server is running
  mindscape start                    Start the background server (Mindscape.command does this)
  mindscape stop                     Stop the background server
  mindscape update                   Get the latest version from GitHub (Mindscape.command does this)
  mindscape review [2026-W42]        Write (or rewrite) a weekly review; last week by default

Used by the /mindscape skill:
  mindscape today                    Create today's daily note if it doesn't exist
  mindscape briefing                 Follow-ups and cards gone quiet
  mindscape index                    Cards (with ids) and reference notes
  mindscape intake pending [--include-today]   Daily-note lines not processed yet
  mindscape intake validate [file]   Check a proposals draft
  mindscape intake submit            Check intake/draft.json and send it to the Intake screen
`;

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function serverHealth(port: number): Promise<{ ok: boolean; pid?: number } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as { ok: boolean; pid?: number }) : null;
  } catch {
    return null;
  }
}

function setup(args: string[]) {
  const vault = argValue(args, '--vault');
  // Validate before saving, so a rejected path never lands in settings.
  const vaultPath = vault ? resolve(expandHome(vault)) : loadSettings().vaultPath;
  assertVaultOutsideRepo(vaultPath);
  const settings = saveSettings({ vaultPath });
  const { created } = ensureVault(settings.vaultPath);
  console.log(`Settings: ${settingsFile()}`);
  console.log(`Vault:    ${settings.vaultPath}`);
  console.log(created.length ? `Created:  ${created.join(', ')}` : 'Vault folders already exist.');
  if (!args.includes('--no-skill')) console.log(installSkill(settings.vaultPath));
}

async function doctor() {
  let problems = 0;
  const line = (ok: boolean, label: string, detail: string) => {
    if (!ok) problems++;
    console.log(`${ok ? '✓' : '✗'} ${label.padEnd(10)} ${detail}`);
  };

  line(nodeMajor() >= MIN_NODE_MAJOR, 'Node', `${process.version} (need ${MIN_NODE_MAJOR}+)`);
  line(true, 'Repo', REPO_ROOT);

  const buildFile = join(REPO_ROOT, 'release', 'BUILD.json');
  if (existsSync(buildFile)) {
    const build = JSON.parse(readFileSync(buildFile, 'utf8')) as { version: string; source: string; builtAt: string };
    const current = sourceHash();
    line(
      build.source === current,
      'Release',
      `v${build.version}, built ${new Date(build.builtAt).toLocaleString()}` +
        (build.source === current ? ' (matches the code)' : ` — STALE: code changed since this build; run: npm run release`),
    );
  } else {
    line(false, 'Release', 'release/ is missing — run: git pull (or npm run release on the dev Mac)');
  }
  line(existsSync(settingsFile()), 'Settings', existsSync(settingsFile()) ? settingsFile() : `missing — run: npm run setup`);

  const { vaultPath, port } = loadSettings();
  try {
    assertVaultOutsideRepo(vaultPath);
    line(existsSync(vaultPath), 'Vault', existsSync(vaultPath) ? `${vaultPath} (${listVaultFiles(vaultPath).length} files)` : `${vaultPath} — not created yet`);
  } catch (err) {
    line(false, 'Vault', (err as Error).message);
  }

  const skill = skillStatus(vaultPath);
  const skillDetail = {
    current: `${skillPath()} (up to date)`,
    outdated: `${skillPath()} — out of date; run: mindscape install-skill`,
    missing: 'not installed; run: mindscape install-skill',
    foreign: `${skillPath()} wasn't installed by Mindscape`,
  }[skill];
  line(skill === 'current', 'Skill', skillDetail);

  const health = await serverHealth(port);
  console.log(`${health ? '✓' : '·'} ${'Server'.padEnd(10)} ${health ? `running on 127.0.0.1:${port} (pid ${health.pid})` : 'not running'}`);
  process.exitCode = problems ? 1 : 0;
}

/**
 * Start the server fully detached from this Terminal window (its own session, no
 * terminal attached), so closing the window doesn't ask to terminate it.
 */
async function start() {
  const { port } = loadSettings();
  if (await serverHealth(port)) {
    console.log(`Mindscape is already running on http://127.0.0.1:${port}`);
    return;
  }
  const server = join(REPO_ROOT, 'release', 'server.mjs');
  if (!existsSync(server)) throw new Error('The prebuilt app (release/) is missing. In this folder, run: git pull');
  mkdirSync(logDir(), { recursive: true });
  const log = join(logDir(), 'server.log');
  const out = openSync(log, 'a');
  spawn(process.execPath, [server], { cwd: REPO_ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await serverHealth(port)) {
      console.log(`Mindscape is running on http://127.0.0.1:${port}`);
      return;
    }
  }
  const tail = readFileSync(log, 'utf8').trimEnd().split('\n').slice(-15).join('\n');
  throw new Error(`Mindscape didn't start. Last lines of ${log}:\n${tail}`);
}

/**
 * Close the launcher's Terminal window (the one on `tty`) once the launcher has
 * finished. Closing it while the script is still exiting makes Terminal ask
 * "terminate running processes?", so this waits until nothing at all is left
 * running in it ("busy" alone isn't enough: it's false while the script exits).
 * macOS reuses tty names, so finished windows from earlier launches on the same
 * tty are closed too.
 * Runs detached, so it isn't itself a process in that window.
 */
function closeLauncherWindow(tty: string | undefined) {
  if (!tty?.startsWith('/dev/')) return;
  const script = [
    'on run argv',
    '  set target to item 1 of argv',
    '  tell application "Terminal"',
    '    repeat 40 times',
    '      set waiting to false',
    '      try',
    '        repeat with w in (every window)',
    '          repeat with t in tabs of w',
    '            if tty of t is target then',
    '              if (count of processes of t) > 0 then',
    '                set waiting to true',
    '              else',
    '                close w',
    '              end if',
    '            end if',
    '          end repeat',
    '        end repeat',
    '      end try',
    '      if not waiting then return',
    '      delay 0.25',
    '    end repeat',
    '  end tell',
    'end run',
  ].flatMap((line) => ['-e', line]);
  spawn('/usr/bin/osascript', [...script, tty], { detached: true, stdio: 'ignore' }).unref();
}

/** Fast-forward to the latest version, then refresh the /mindscape skill if it's ours and out of date. */
function update() {
  const result = updateRepo();
  if (result.status === 'current') console.log('Mindscape is up to date.');
  else if (result.status === 'skipped') console.log(`Update skipped: ${result.reason}`);
  else {
    console.log(`Updated Mindscape (${result.commits} change${result.commits === 1 ? '' : 's'}, ${result.from} → ${result.to}).`);
    try {
      const { vaultPath } = loadSettings();
      if (skillStatus(vaultPath) === 'outdated') console.log(installSkill(vaultPath));
    } catch {
      // not set up yet: setup installs the skill
    }
  }
}

async function stop() {
  const { port } = loadSettings();
  const health = await serverHealth(port);
  const file = pidFile();
  const pid = health?.pid ?? (existsSync(file) ? Number(readFileSync(file, 'utf8')) : undefined);
  if (!health || !pid) {
    console.log('Mindscape is not running.');
    rmSync(file, { force: true });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped Mindscape (pid ${pid}).`);
  } catch {
    console.log('Mindscape is not running.');
    rmSync(file, { force: true });
  }
}

/** Capture through the running server (so the open page updates), or straight to the file if it's not running. */
async function capture(text: string) {
  if (!text.trim()) throw new Error('Nothing to capture.');
  const { vaultPath, port } = loadSettings();
  assertVaultOutsideRepo(vaultPath);
  let result: CaptureResult | null = null;
  if (await serverHealth(port)) {
    const res = await fetch(`http://127.0.0.1:${port}/api/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${captureToken(vaultPath)}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Capture failed: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.status}`);
    result = (await res.json()) as CaptureResult;
  } else {
    if (!existsSync(vaultPath)) throw new Error(`No vault at ${vaultPath} — run: mindscape setup`);
    const store = new CardStore(vaultPath);
    ensureDailyTemplate(store.files);
    result = captureLocally(store, text);
  }
  console.log(result.kind === 'card' ? `Added card: ${result.card.title}` : `Captured to ${result.date}: ${result.line}`);
}

const COMMANDS = new Set([
  'setup', 'doctor', 'start', 'stop', 'capture', 'token', 'close-launcher-window', 'install-skill',
  'today', 'briefing', 'index', 'intake', 'review', 'update', 'help', '--help', '-h',
]);

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'setup') setup(rest);
  else if (command === 'doctor') await doctor();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'close-launcher-window') closeLauncherWindow(rest[0]);
  else if (command === 'capture') await capture(rest.join(' '));
  else if (command === 'token') console.log(captureToken(loadSettings().vaultPath));
  else if (command === 'install-skill') console.log(installSkill(loadSettings().vaultPath));
  else if (command === 'today') today();
  else if (command === 'briefing') printBriefing();
  else if (command === 'index') printIndex();
  else if (command === 'intake') intake(rest);
  else if (command === 'review') review(rest[0]);
  else if (command === 'update') update();
  // Anything with a space in it is a capture; a single unknown word is more likely a typo.
  else if (command && !COMMANDS.has(command) && !command.startsWith('-') && [command, ...rest].join(' ').includes(' ')) {
    await capture([command, ...rest].join(' '));
  } else {
    console.log(USAGE);
    if (command && command !== 'help' && command !== '--help') process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
