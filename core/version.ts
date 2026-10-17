import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './vault.ts';

export const APP_VERSION: string = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

export const MIN_NODE_MAJOR = 20;

export function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0]);
}
