// Today's priorities: up to five cards pinned to a day, one file per day
// (pins/YYYY-MM-DD.json). Each pin keeps when it started and stopped, so the
// pin bonus is worked out from history like every other point. Pins never carry
// over: each day starts empty.
import type { VaultFiles } from './files.ts';
import { toLocalDate, toLocalIso } from './time.ts';

export const MAX_PINS = 5;
export const PINS_FOLDER = 'pins';

export interface PinEntry {
  id: string;
  at: string;
  /** When it was unpinned (still pinned if missing). */
  until?: string;
}

export interface DayPins {
  date: string;
  pins: PinEntry[];
}

export const pinsPath = (date: string) => `${PINS_FOLDER}/${date}.json`;

export function readDay(files: VaultFiles, date: string = toLocalDate()): DayPins {
  const text = files.read(pinsPath(date));
  if (!text) return { date, pins: [] };
  try {
    const data = JSON.parse(text) as { pins?: unknown };
    const pins = Array.isArray(data.pins)
      ? data.pins.filter((p): p is PinEntry => !!p && typeof p.id === 'string' && typeof p.at === 'string')
      : [];
    return { date, pins };
  } catch {
    return { date, pins: [] };
  }
}

/** Card ids pinned right now, in the order they were pinned. */
export function pinnedIds(day: DayPins): string[] {
  return day.pins.filter((p) => !p.until).map((p) => p.id);
}

/** Every day that has pins, oldest first. */
export function loadAllPins(files: VaultFiles): DayPins[] {
  return files
    .filesIn(PINS_FOLDER, '.json')
    .map((rel) => rel.slice(PINS_FOLDER.length + 1, -'.json'.length))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .map((date) => readDay(files, date));
}

function writeDay(files: VaultFiles, day: DayPins) {
  files.write(pinsPath(day.date), `${JSON.stringify({ pins: day.pins }, null, 2)}\n`);
}

export type PinResult = { ok: true; day: DayPins } | { ok: false; reason: 'limit' };

export function pin(files: VaultFiles, id: string, now: Date = new Date()): PinResult {
  const day = readDay(files, toLocalDate(now));
  if (pinnedIds(day).includes(id)) return { ok: true, day };
  if (pinnedIds(day).length >= MAX_PINS) return { ok: false, reason: 'limit' };
  const next = { ...day, pins: [...day.pins, { id, at: toLocalIso(now) }] };
  writeDay(files, next);
  return { ok: true, day: next };
}

export function unpin(files: VaultFiles, id: string, now: Date = new Date()): DayPins {
  const day = readDay(files, toLocalDate(now));
  if (!pinnedIds(day).includes(id)) return day;
  const next = { ...day, pins: day.pins.map((p) => (p.id === id && !p.until ? { ...p, until: toLocalIso(now) } : p)) };
  writeDay(files, next);
  return next;
}
