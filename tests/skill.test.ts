import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installSkill, renderSkill, skillPath, skillStatus } from '../cli/claudeSkill.ts';
import { REPO_ROOT } from '../core/vault.ts';

const dir = mkdtempSync(join(tmpdir(), 'mindscape-skill-'));
const VAULT = '/Users/someone/Desktop/Mindscape Vault';
beforeAll(() => {
  process.env.CLAUDE_CONFIG_DIR = dir;
});
afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('the /mindscape skill', () => {
  it("is filled in with this Mac's paths, with nothing left over", () => {
    const text = renderSkill(VAULT);
    expect(text).not.toContain('{{');
    expect(text).toMatch(/^---\nname: mindscape\n/);
    expect(text).toContain(`  - Bash(${join(REPO_ROOT, 'bin', 'mindscape')}:*)`);
    expect(text).toContain(`  - Read(/${VAULT}/**)`);
    expect(text).toContain(`  - Write(/${VAULT}/intake/draft.json)`);
  });

  it('installs, reports when out of date, and never replaces a skill it did not write', () => {
    expect(skillStatus(VAULT)).toBe('missing');
    installSkill(VAULT);
    expect(skillStatus(VAULT)).toBe('current');
    expect(skillStatus('/elsewhere')).toBe('outdated');
    writeFileSync(skillPath(), 'my own skill');
    expect(installSkill(VAULT)).toMatch(/^Skipped/);
    expect(readFileSync(skillPath(), 'utf8')).toBe('my own skill');
  });
});
