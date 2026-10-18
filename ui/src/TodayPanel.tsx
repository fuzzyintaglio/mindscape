import type { StoredCard } from '../../core/cards.ts';
import { briefing, daysUntouched } from '../../core/today.ts';
import { formatDate } from './Board.tsx';

/** Live nudges at the top of today's note. Worked out from the cards; never stored in the note. */
export function TodayPanel({ cards, onOpen }: { cards: StoredCard[]; onOpen: (id: string) => void }) {
  const { followUp, stale } = briefing(cards);
  if (followUp.length === 0 && stale.length === 0) {
    return (
      <section className="today-panel quiet" aria-label="Today">
        <p className="muted">Nothing needs a nudge today.</p>
      </section>
    );
  }
  return (
    <section className="today-panel" aria-label="Today">
      {followUp.length > 0 && (
        <div className="today-group">
          <h3>Follow up</h3>
          <ul>
            {followUp.map((c) => (
              <li key={c.id}>
                <button className="link-button" onClick={() => onOpen(c.id)}>
                  {c.title}
                </button>
                <span className="muted small">
                  {c.blockedBy ? `Waiting on ${c.blockedBy} · ` : ''}expected {formatDate(c.unblockBy!)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stale.length > 0 && (
        <div className="today-group">
          <h3>Gone quiet</h3>
          <ul>
            {stale.map((c) => (
              <li key={c.id}>
                <button className="link-button" onClick={() => onOpen(c.id)}>
                  {c.title}
                </button>
                <span className="muted small">In Progress, untouched for {daysUntouched(c)} days</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
