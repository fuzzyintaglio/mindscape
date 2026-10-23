import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Card, moveCard, newCard } from '../core/cards.ts';
import { DEFAULT_CONFIG } from '../core/configDefaults.ts';
import { VaultFiles } from '../core/files.ts';
import { type DayPins, MAX_PINS, loadAllPins, pin, pinnedIds, readDay, unpin } from '../core/pins.ts';
import { allEvents, pinEvents, summarizeWeek } from '../core/points.ts';

const at = (h: number, m = 0, day = 23) => new Date(2026, 9, day, h, m);
const iso = (d: Date) => {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};

describe('pin files', () => {
  let vault: string;
  let files: VaultFiles;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'mindscape-pins-'));
    files = new VaultFiles(vault);
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it('pins up to five cards a day, remembers unpins, and starts each day empty', () => {
    for (let i = 0; i < MAX_PINS; i++) expect(pin(files, `C${i}`, at(9, i)).ok).toBe(true);
    expect(pin(files, 'C9', at(9, 30))).toEqual({ ok: false, reason: 'limit' });
    expect(pin(files, 'C0', at(9, 31)).ok).toBe(true); // already pinned: fine, nothing changes
    unpin(files, 'C1', at(10));
    expect(pin(files, 'C9', at(10, 5)).ok).toBe(true);
    const today = readDay(files, '2026-10-23');
    expect(pinnedIds(today)).toEqual(['C0', 'C2', 'C3', 'C4', 'C9']);
    expect(today.pins.find((p) => p.id === 'C1')!.until).toBeTruthy();
    expect(pinnedIds(readDay(files, '2026-10-24'))).toEqual([]);
    expect(loadAllPins(files).map((d) => d.date)).toEqual(['2026-10-23']);
  });
});

describe('the pin bonus', () => {
  const card = (effort: Card['effort'] = 'medium') => newCard({ id: 'P', title: 'Pinned card', effort, now: iso(at(8, 0, 20)) });
  const day = (pins: DayPins['pins'], date = '2026-10-23'): DayPins => ({ date, pins });
  const started = (c: Card, when: Date) => moveCard(c, 'in-progress', iso(when));

  it('pays 50 / 75 / 150 for starting a pinned card that day, while it was pinned', () => {
    const pins = [day([{ id: 'P', at: iso(at(9)) }])];
    for (const [effort, points] of [['low', 50], ['medium', 75], ['high', 150]] as const) {
      expect(pinEvents([started(card(effort), at(11))], pins, DEFAULT_CONFIG)).toMatchObject([{ kind: 'pin', points }]);
    }
  });

  it('pays nothing when the card was not pinned at the time, or moved another day', () => {
    const pinnedLater = [day([{ id: 'P', at: iso(at(12)) }])];
    expect(pinEvents([started(card(), at(11))], pinnedLater, DEFAULT_CONFIG)).toEqual([]);
    const unpinnedFirst = [day([{ id: 'P', at: iso(at(9)), until: iso(at(10)) }])];
    expect(pinEvents([started(card(), at(11))], unpinnedFirst, DEFAULT_CONFIG)).toEqual([]);
    const yesterday = [day([{ id: 'P', at: iso(at(9, 0, 22)) }], '2026-10-22')];
    expect(pinEvents([started(card(), at(11))], yesterday, DEFAULT_CONFIG)).toEqual([]);
    expect(pinEvents([started(card(), at(11))], [], DEFAULT_CONFIG)).toEqual([]);
  });

  it('pays once per card per day, however often it moves back and forth', () => {
    const pins = [day([{ id: 'P', at: iso(at(9)) }])];
    let c = started(card(), at(10));
    c = moveCard(c, 'not-started', iso(at(10, 5)));
    c = moveCard(c, 'in-progress', iso(at(10, 10)));
    expect(pinEvents([c], pins, DEFAULT_CONFIG)).toHaveLength(1);
  });

  it('counts in the week, and undoing the move (restoring the old file) takes it back', () => {
    const pins = [day([{ id: 'P', at: iso(at(9)) }])];
    const summary = summarizeWeek(allEvents([started(card('high'), at(11))], DEFAULT_CONFIG, pins), '2026-W43');
    expect(summary).toMatchObject({ points: 150, pinStarts: 1, pinPoints: 150, closed: 0 });
    expect(summarizeWeek(allEvents([card('high')], DEFAULT_CONFIG, pins), '2026-W43').points).toBe(0);
  });
});
