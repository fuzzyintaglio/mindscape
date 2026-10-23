// Stickies: throwaway notes for one day (a number to remember, an address). They live
// in stickies/YYYY-MM-DD.md, one per block with a "---" line between them, and are
// never part of the daily note, so intake never reads them. Search does.
import type { VaultFiles } from './files.ts';

export const STICKIES_FOLDER = 'stickies';
export const stickiesPath = (date: string) => `${STICKIES_FOLDER}/${date}.md`;

const SEPARATOR = /\n-{3,}\n/;

export function parseStickies(text: string): string[] {
  return `\n${text.replace(/\r\n/g, '\n')}\n`
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeStickies(items: string[]): string {
  const kept = items.map((s) => s.replace(/\r\n/g, '\n').replace(/^-{3,}$/gm, '—').trim()).filter(Boolean);
  return kept.length ? `${kept.join('\n\n---\n\n')}\n` : '';
}

export function readStickies(files: VaultFiles, date: string): string[] {
  return parseStickies(files.read(stickiesPath(date)) ?? '');
}

/** Save a day's stickies; an empty list removes the file. */
export function saveStickies(files: VaultFiles, date: string, items: string[]): string[] {
  const text = serializeStickies(items);
  files.write(stickiesPath(date), text || null);
  return parseStickies(text);
}
