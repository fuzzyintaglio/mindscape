import { useEffect, useState } from 'react';

// Phase 0 check: can the page take over these browser shortcuts?
// If a key never turns green, the browser kept it for itself and we'll remap it.
const SHORTCUTS = [
  { key: 's', label: '⌘S', use: 'Save a note' },
  { key: 'k', label: '⌘K', use: 'Search' },
  { key: 'j', label: '⌘J', use: 'Quick Capture' },
] as const;

type Key = (typeof SHORTCUTS)[number]['key'];

export function ShortcutCheck() {
  const [seen, setSeen] = useState<Record<Key, boolean>>({ s: false, k: false, j: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 's' || k === 'k' || k === 'j') {
        e.preventDefault();
        setSeen((prev) => ({ ...prev, [k]: true }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="panel">
      <h2>Shortcut check</h2>
      <p className="muted">
        Press each shortcut once with this page focused. Green means Mindscape can use it. If the browser does
        something else instead (like opening Downloads), it stays grey — note which ones.
      </p>
      <ul className="shortcuts">
        {SHORTCUTS.map((s) => (
          <li key={s.key} className={seen[s.key] ? 'ok' : ''}>
            <kbd>{s.label}</kbd>
            <span>{s.use}</span>
            <span className="status">{seen[s.key] ? '✓ works' : 'not yet pressed'}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Browser: {navigator.userAgent}</p>
    </section>
  );
}
