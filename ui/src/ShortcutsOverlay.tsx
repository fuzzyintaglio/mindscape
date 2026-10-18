import { useEffect } from 'react';

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      [['⌘K', '/'], 'Search'],
      [['⌘J'], 'Capture a line (t: … makes a card)'],
      [['n'], 'New card'],
      [['⌘Z'], 'Undo the last change, while its Undo button shows'],
      [['?'], 'Show this list'],
      [['Esc'], 'Close a panel or dialog, or leave a text box'],
    ],
  },
  {
    title: 'Go to',
    keys: [
      [['g', 'b'], 'Board'],
      [['g', 'd'], 'Today’s note'],
      [['g', 'n'], 'Notes'],
      [['g', 'i'], 'Intake'],
      [['g', 'a'], 'Archive'],
      [['g', 'r'], 'Reviews'],
      [['g', 's'], 'Settings'],
    ],
  },
  {
    title: 'Board',
    keys: [
      [['←', '↑', '→', '↓'], 'Select a card'],
      [['Enter'], 'Open it'],
      [['1', '2', '3', '4'], 'Move to Not Started, In Progress, Blocked, Complete'],
      [['e'], 'Change effort'],
      [['⌫'], 'Delete (⌘Z brings it back)'],
    ],
  },
  {
    title: 'Writing',
    keys: [
      [['⌘S'], 'Save notes'],
      [['Esc'], 'Stop editing'],
      [['Tab', '⇧Tab'], 'Indent or outdent a list item'],
    ],
  },
  {
    title: 'Daily notes & reviews',
    keys: [[['←', '→'], 'Previous or next day (or week), when you’re not typing']],
  },
];

/** The `?` list of keyboard shortcuts. */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <header className="shortcuts-header">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close" autoFocus>
            ×
          </button>
        </header>
        <div className="shortcuts-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.keys.map(([keys, what]) => (
                  <div key={what} className="shortcut-row">
                    <dt>
                      {keys.map((k, i) => (
                        <kbd key={i}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
