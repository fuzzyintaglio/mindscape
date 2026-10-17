import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../core/vault.ts';
import { sourceHash } from '../scripts/source-hash.mjs';

// The work Mac runs release/ as-is, so a stale release means shipping old code.
describe('release/', () => {
  it('contains everything the work Mac needs', () => {
    for (const f of ['server.mjs', 'cli.mjs', 'ui/index.html', 'BUILD.json']) {
      expect(existsSync(join(REPO_ROOT, 'release', f)), `release/${f}`).toBe(true);
    }
  });

  it('was built from the current code (if this fails: npm run release)', () => {
    const build = JSON.parse(readFileSync(join(REPO_ROOT, 'release', 'BUILD.json'), 'utf8'));
    expect(build.source).toBe(sourceHash());
  });
});
