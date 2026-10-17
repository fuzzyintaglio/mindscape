import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sourceHash } from '../scripts/source-hash.mjs';
import { expandHome, loadSettings, pidFile, saveSettings, settingsFile } from '../core/settings.ts';
import { assertVaultOutsideRepo, ensureVault, listVaultFiles, REPO_ROOT } from '../core/vault.ts';
import { APP_VERSION, MIN_NODE_MAJOR, nodeMajor } from '../core/version.ts';

// Phase 0 commands. index / briefing / today / intake / capture arrive in later phases.
const USAGE = `mindscape ${APP_VERSION}

Usage:
  mindscape setup [--vault <path>]   Save this machine's vault location and create the vault folders
  mindscape doctor                   Check Node, settings, vault, and whether the server is running
  mindscape stop                     Stop the background server
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

  const health = await serverHealth(port);
  console.log(`${health ? '✓' : '·'} ${'Server'.padEnd(10)} ${health ? `running on 127.0.0.1:${port} (pid ${health.pid})` : 'not running'}`);
  process.exitCode = problems ? 1 : 0;
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

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'setup') setup(rest);
  else if (command === 'doctor') await doctor();
  else if (command === 'stop') await stop();
  else {
    console.log(USAGE);
    if (command && command !== 'help' && command !== '--help') process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
