import { useCallback, useEffect, useState } from 'react';
import type { StoredCard } from '../../core/cards.ts';
import { DEFAULT_CONFIG } from '../../core/configDefaults.ts';
import { type BoardData, api } from './api.ts';
import { onVaultChange, useLiveStatus } from './live.ts';

/** Board state, kept in sync with the vault: reloads whenever the server says files changed. */
export function useBoard() {
  const [data, setData] = useState<BoardData>({ cards: [], problems: [], config: DEFAULT_CONFIG, points: { week: '', points: 0, closed: 0, days: [0, 0, 0, 0, 0, 0, 0], best: 0 }, intakePending: 0, unprocessedDays: 0, pins: { date: '', pins: [] } });
  const [loaded, setLoaded] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const live = useLiveStatus();

  const reload = useCallback(async () => {
    try {
      setData(await api.board());
      setLoaded(true);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return onVaultChange(() => void reload());
  }, [reload]);

  const offline = unreachable || !live;

  /** Show a change immediately, before the server confirms it. */
  const patchLocal = useCallback((id: string, patch: Partial<StoredCard>) => {
    setData((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }, []);

  /** Apply the card the server returned after a change, without waiting for the next reload. */
  const upsertLocal = useCallback((card: StoredCard) => {
    setData((d) => ({ ...d, cards: [...d.cards.filter((c) => c.id !== card.id), card] }));
  }, []);

  const removeLocal = useCallback((id: string) => {
    setData((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
  }, []);

  return { ...data, loaded, offline, reload, patchLocal, upsertLocal, removeLocal, setData };
}
