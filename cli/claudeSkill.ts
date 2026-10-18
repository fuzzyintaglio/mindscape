// Installs the /mindscape skill for Claude Code (user level, so it works in any
// session), filled in with this Mac's paths. Its allowed-tools give it just what
// it needs while it runs: the mindscape CLI, reading the vault, and writing the
// intake draft.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from '../core/vault.ts';

const MARKER = 'mindscape-skill:';

export function skillPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'skills', 'mindscape', 'SKILL.md');
}

/** The skill text for this Mac. */
export function renderSkill(vaultPath: string): string {
  const template = readFileSync(join(REPO_ROOT, 'skills', 'mindscape', 'SKILL.md'), 'utf8');
  return template
    .replaceAll('{{CLI}}', join(REPO_ROOT, 'bin', 'mindscape'))
    .replaceAll('{{VAULT}}', vaultPath)
    .replaceAll('{{REPO}}', REPO_ROOT);
}

export type SkillStatus = 'current' | 'outdated' | 'missing' | 'foreign';

export function skillStatus(vaultPath: string): SkillStatus {
  const path = skillPath();
  if (!existsSync(path)) return 'missing';
  const installed = readFileSync(path, 'utf8');
  if (!installed.includes(MARKER)) return 'foreign';
  return installed === renderSkill(vaultPath) ? 'current' : 'outdated';
}

/** Write the skill. Never replaces a /mindscape skill that this app didn't install. */
export function installSkill(vaultPath: string): string {
  const path = skillPath();
  if (skillStatus(vaultPath) === 'foreign') {
    return `Skipped the /mindscape skill: ${path} exists and wasn't installed by Mindscape. Move it aside and run: mindscape install-skill`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderSkill(vaultPath));
  return `Skill:    ${path} (/mindscape in Claude Code)`;
}
