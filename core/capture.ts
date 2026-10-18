// Quick Capture, shared by the server and the CLI: `t: …` makes a card right
// away; anything else is appended to today's daily note.
import type { StoredCard } from './cards.ts';
import { appendCapture, taskFromCapture } from './daily.ts';
import type { CardStore } from './store.ts';

export type CaptureResult =
  | { kind: 'card'; card: StoredCard; undoId: string }
  | { kind: 'note'; date: string; line: string };

export function capture(store: CardStore, text: string, now: Date = new Date()): CaptureResult {
  const title = taskFromCapture(text);
  if (title) return { kind: 'card', ...store.create({ title }) };
  return { kind: 'note', ...appendCapture(store.files, text, now) };
}
