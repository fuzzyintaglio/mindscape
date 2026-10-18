// Hash routes: #/ (board), #/daily/2026-10-18, #/notes, #/notes/<name>, #/intake, #/archive, #/reviews, #/reviews/2026-W42.
import { useEffect, useRef, useState } from 'react';
import { toLocalDate } from '../../core/time.ts';

export type Route =
  | { view: 'board' }
  | { view: 'daily'; date: string; find?: string }
  | { view: 'notes' }
  | { view: 'intake' }
  | { view: 'archive' }
  | { view: 'reviews' }
  | { view: 'review'; week: string }
  | { view: 'note'; name: string };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [view, ...rest] = path.split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : '';
  if (view === 'daily') {
    const find = new URLSearchParams(query).get('find') || undefined;
    return { view: 'daily', date: /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : toLocalDate(), ...(find ? { find } : {}) };
  }
  if (view === 'notes') return arg ? { view: 'note', name: arg } : { view: 'notes' };
  if (view === 'intake') return { view: 'intake' };
  if (view === 'archive') return { view: 'archive' };
  if (view === 'reviews') return /^\d{4}-W\d{2}$/.test(arg) ? { view: 'review', week: arg } : { view: 'reviews' };
  return { view: 'board' };
}

export const hrefFor = {
  board: () => '#/',
  daily: (date?: string, find?: string) => (date ? `#/daily/${date}` : '#/daily') + (find ? `?find=${encodeURIComponent(find)}` : ''),
  notes: () => '#/notes',
  intake: () => '#/intake',
  archive: () => '#/archive',
  reviews: () => '#/reviews',
  review: (week: string) => `#/reviews/${week}`,
  note: (name: string) => `#/notes/${encodeURIComponent(name)}`,
};

export function navigate(href: string) {
  window.location.hash = href;
}

/**
 * The current route. `canLeave` is asked before every change (e.g. unsaved edits);
 * if it says no, the address goes back to where it was.
 */
export function useRoute(canLeave: () => boolean): Route {
  const [hash, setHash] = useState(window.location.hash);
  const current = useRef(hash);
  const guard = useRef(canLeave);
  guard.current = canLeave;

  useEffect(() => {
    const onChange = () => {
      const next = window.location.hash;
      if (next === current.current) return;
      if (!guard.current()) {
        window.history.replaceState(null, '', current.current || '#/');
        return;
      }
      current.current = next;
      setHash(next);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return parseRoute(hash);
}
