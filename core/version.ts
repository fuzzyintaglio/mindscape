import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './vault.ts';

// Inlined by esbuild in release builds; read from package.json when running from source.
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

/** True when running the prebuilt release/ bundle rather than source via tsx. */
export const BUNDLED = process.env.MINDSCAPE_BUNDLED === '1';

export const MIN_NODE_MAJOR = 20;

export function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0]);
}
