// "Export vault as .zip": every file in the vault, inside a folder named after it,
// so unzipping gives back a complete vault that Mindscape (or Obsidian) can open.
// Left out: the vault's git history (.git), macOS clutter, half-written temp files,
// and the capture token (a new one is made when it's next needed).
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { toLocalDate } from './time.ts';
import { type ZipEntry, createZip } from './zip.ts';

const SKIP_NAMES = new Set(['.git', '.DS_Store']);
const TEMP_FILE = /^\..+\.tmp-\d+$/;
const CONFIG = '.mindscape/config.json';

export function vaultEntries(vault: string): ZipEntry[] {
  const root = basename(vault);
  const out: ZipEntry[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(vault, rel)).sort()) {
      if (SKIP_NAMES.has(name) || TEMP_FILE.test(name)) continue;
      const path = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(join(vault, path));
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        let data: Buffer = readFileSync(join(vault, path));
        if (path === CONFIG) data = withoutToken(data);
        out.push({ name: `${root}/${path}`, data, modified: stat.mtime });
      }
      // symlinks and anything else are skipped
    }
  };
  walk('');
  return out;
}

function withoutToken(data: Buffer): Buffer {
  try {
    const { captureToken: _token, ...rest } = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
    return Buffer.from(JSON.stringify(rest, null, 2) + '\n');
  } catch {
    return data;
  }
}

export function exportVault(vault: string, now: Date = new Date()): { fileName: string; data: Buffer; files: number } {
  const entries = vaultEntries(vault);
  return { fileName: `${basename(vault)} ${toLocalDate(now)}.zip`, data: createZip(entries), files: entries.length };
}
