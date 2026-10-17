// Fingerprint of everything that goes into release/. If it doesn't match
// release/BUILD.json, the release is stale and needs `npm run release`.
// Usage: node scripts/source-hash.mjs   → prints the hash
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUTS = ['core', 'server', 'cli', 'ui/src', 'ui/index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'scripts/release.mjs', 'scripts/source-hash.mjs'];

function files(p) {
  const full = join(ROOT, p);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .flatMap((e) => files(join(p, e.name)));
}

export function sourceHash() {
  const hash = createHash('sha256');
  for (const f of INPUTS.flatMap(files).sort()) {
    hash.update(relative(ROOT, f).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(f));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

// Print only when run directly — this file is also bundled into release/cli.mjs.
if (process.argv[1]?.endsWith('source-hash.mjs')) console.log(sourceHash());
