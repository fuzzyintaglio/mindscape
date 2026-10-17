import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredCard } from '../../core/cards.ts';
import { DEFAULT_CONFIG } from '../../core/configDefaults.ts';
import { type BoardData, api } from './api.ts';

/** Board state, kept in sync with the vault: reloads whenever the server says files changed. */
export function useBoard() {
  const [data, setData] = useState<BoardData>({ cards: [], problems: [], config: DEFAULT_CONFIG });
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const timer = useRef<number>();

  const reload = useCallback(async () => {
    try {
      setData(await api.board());
      setLoaded(true);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    const source = new EventSource('/api/events');
    const soon = () => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void reload(), 60);
    };
    source.addEventListener('vault-changed', soon);
    // After a reconnect (e.g. the server restarted), catch up on anything missed.
    source.addEventListener('hello', soon);
    source.onerror = () => setOffline(true);
    return () => source.close();
  }, [reload]);

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
