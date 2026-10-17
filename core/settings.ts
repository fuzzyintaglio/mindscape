import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Machine-level settings live outside both the repo and the vault, in the
// standard macOS app-support location. Vault-level config (points, theme…)
// lives in <vault>/.mindscape/config.json and arrives in Phase 1.

export const DEFAULT_PORT = 4317;
export const DEFAULT_VAULT_PATH = join(homedir(), 'Desktop', 'Mindscape Vault');

export interface Settings {
  vaultPath: string;
  port: number;
}

export function settingsDir(): string {
  return process.env.MINDSCAPE_SETTINGS_DIR ?? join(homedir(), 'Library', 'Application Support', 'Mindscape');
}

export function settingsFile(): string {
  return join(settingsDir(), 'settings.json');
}

export function logDir(): string {
  return process.env.MINDSCAPE_LOG_DIR ?? join(homedir(), 'Library', 'Logs', 'Mindscape');
}

export function pidFile(): string {
  return join(settingsDir(), 'server.pid');
}

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

export function loadSettings(): Settings {
  let stored: Partial<Settings> = {};
  const file = settingsFile();
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
    } catch {
      throw new Error(`Settings file is not valid JSON: ${file}`);
    }
  }
  const vaultPath = process.env.MINDSCAPE_VAULT ?? stored.vaultPath ?? DEFAULT_VAULT_PATH;
  const port = Number(process.env.MINDSCAPE_PORT ?? stored.port ?? DEFAULT_PORT);
  return { vaultPath: resolve(expandHome(vaultPath)), port };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const file = settingsFile();
  let stored: Partial<Settings> = {};
  if (existsSync(file)) stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
  const next = { ...stored, ...patch };
  if (next.vaultPath) next.vaultPath = resolve(expandHome(next.vaultPath));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return loadSettings();
}
