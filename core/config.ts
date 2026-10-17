// Vault-level config: <vault>/.mindscape/config.json. Missing keys fall back to defaults,
// and keys this version doesn't know about are kept when saving.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, THEMES, type Theme, type VaultConfig } from './configDefaults.ts';

export { DEFAULT_CONFIG, THEMES, type Theme, type VaultConfig };

const configFile = (vault: string) => join(vault, '.mindscape', 'config.json');

function readRaw(vault: string): Record<string, unknown> {
  const file = configFile(vault);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function loadConfig(vault: string): VaultConfig {
  const raw = readRaw(vault) as Partial<VaultConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    points: { ...DEFAULT_CONFIG.points, ...(raw.points ?? {}) },
    theme: THEMES.includes(raw.theme as Theme) ? (raw.theme as Theme) : DEFAULT_CONFIG.theme,
  };
}

/** Write the config file with defaults filled in, if it doesn't exist yet. */
export function ensureConfig(vault: string): void {
  const file = configFile(vault);
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
}

export function saveConfig(vault: string, patch: Partial<VaultConfig>): VaultConfig {
  const next = { ...readRaw(vault), ...patch };
  mkdirSync(dirname(configFile(vault)), { recursive: true });
  writeFileSync(configFile(vault), JSON.stringify(next, null, 2) + '\n');
  return loadConfig(vault);
}
