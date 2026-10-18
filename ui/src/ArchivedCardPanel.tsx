import { useEffect } from 'react';
import type { StoredCard } from '../../core/cards.ts';
import { refName } from '../../core/links.ts';
import { Markdown } from './Markdown.tsx';
import { hrefFor } from './route.ts';

const EFFORT_NAME = { low: 'Low', medium: 'Medium', high: 'High' } as const;

/** A read-only look at an archived card, from the Archive or a search result. Restore puts it back on the board. */
export function ArchivedCardPanel({ card, onClose, onRestore }: { card: StoredCard; onClose: () => void; onRestore: (card: StoredCard) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
  return (
    <aside className="panel-card" aria-label="Archived card">
      <div className="panel-top">
        <span className="panel-path" title={card.path}>
          Archived
        </span>
        <button className="icon-button" onClick={onClose} aria-label="Close card" title="Close (Esc)">
          ×
        </button>
      </div>
      <h2 className="panel-title static">{card.title}</h2>
      <p className="muted small">
        {EFFORT_NAME[card.effort]} effort · completed {day(card.completed)} · archived {day(card.archived)}
      </p>
      {card.refs.length > 0 && (
        <section className="panel-section">
          <h3>Linked notes</h3>
          <ul className="plain-list">
            {card.refs.map((r) => (
              <li key={r}>
                <a href={hrefFor.note(refName(r))}>{refName(r)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel-section">
        <h3>Notes</h3>
        {card.notes ? <Markdown text={card.notes} /> : <p className="muted small">No notes.</p>}
      </section>
      {card.log && (
        <section className="panel-section">
          <h3>Log</h3>
          <Markdown text={card.log} className="log" />
        </section>
      )}
      <footer className="panel-footer">
        <span className="muted small">Restoring puts it in In Progress; its points come off until you complete it again.</span>
        <button className="button bordered" onClick={() => onRestore(card)}>
          Restore to board
        </button>
      </footer>
    </aside>
  );
}
