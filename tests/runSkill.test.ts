import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skillStatus } from '../core/claudeSkill.ts';
import { findClaude, runMindscape, runScript } from '../core/runSkill.ts';

const dir = mkdtempSync(join(tmpdir(), 'mindscape-run-'));
const VAULT = "/Users/someone/Desktop/Mindscape Vault (Sam's)";
beforeAll(() => {
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude');
  process.env.MINDSCAPE_SETTINGS_DIR = join(dir, 'settings');
});
afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.MINDSCAPE_SETTINGS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('Run /mindscape', () => {
  it('writes a script that opens Claude Code in the vault with /mindscape', () => {
    const script = runScript(VAULT, '/opt/bin/claude', false);
    expect(script).toContain(`cd '/Users/someone/Desktop/Mindscape Vault (Sam'\\''s)' || exit 1`);
    expect(script).toContain(`CLAUDE='/opt/bin/claude'`);
    expect(script.trimEnd().endsWith(`exec "$CLAUDE" '/mindscape'`)).toBe(true);
    expect(runScript(VAULT, null, true)).toContain(`CLAUDE=claude`);
    expect(runScript(VAULT, null, true).trimEnd().endsWith(`'/mindscape include today'`)).toBe(true);
  });

  it('finds claude on PATH', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'claude'), '');
    expect(findClaude(`/nowhere:${bin}`)).toBe(join(bin, 'claude'));
  });

  it('installs or refreshes the skill, then opens Terminal on the script', () => {
    const opened: string[] = [];
    expect(runMindscape(VAULT, true, (p) => opened.push(p))).toEqual({ ok: true, skill: 'installed' });
    expect(skillStatus(VAULT)).toBe('current');
    expect(opened).toEqual([join(dir, 'settings', 'run-mindscape.command')]);
    expect(statSync(opened[0]!).mode & 0o111).not.toBe(0);
    expect(readFileSync(opened[0]!, 'utf8')).toContain('/mindscape include today');
    expect(runMindscape(VAULT, false, () => {})).toEqual({ ok: true, skill: 'current' });
  });
});
