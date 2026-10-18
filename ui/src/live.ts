// One connection to the server's live updates, shared by everything on the page.
import { useEffect, useState } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<(live: boolean) => void>();
let source: EventSource | null = null;
let live = true;
let timer: number | undefined;

function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  for (const l of statusListeners) l(live);
}

function connect() {
  if (source) return;
  source = new EventSource('/api/events');
  // Many file events arrive together (a save touches several files); react once.
  const changed = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      for (const l of [...listeners]) l();
    }, 60);
  };
  source.addEventListener('vault-changed', changed);
  // After a reconnect (e.g. the server restarted), catch up on anything missed.
  source.addEventListener('hello', () => {
    setLive(true);
    changed();
  });
  source.onerror = () => setLive(false);
}

/** Call `fn` whenever anything in the vault changes. Returns an unsubscribe function. */
export function onVaultChange(fn: Listener): () => void {
  connect();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLiveStatus(): boolean {
  const [state, setState] = useState(live);
  useEffect(() => {
    statusListeners.add(setState);
    return () => void statusListeners.delete(setState);
  }, []);
  return state;
}
