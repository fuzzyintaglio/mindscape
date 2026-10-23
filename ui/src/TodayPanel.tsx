import { type StoredCard, dueState } from '../../core/cards.ts';
import { type WeekStrip, formatPoints } from '../../core/points.ts';
import { briefing, daysUntouched } from '../../core/today.ts';
import { dueLabel, formatDate } from './Board.tsx';

interface Props {
  cards: StoredCard[];
  points: WeekStrip;
  unprocessedDays: number;
  onRunMindscape: () => void;
  onOpen: (id: string) => void;
}

/** Live nudges at the top of today's note. Worked out from the cards; never stored in the note. */
export function TodayPanel({ cards, points, unprocessedDays, onRunMindscape, onOpen }: Props) {
  const { followUp, stale, due } = briefing(cards);
  const week = (
    <p className="today-points">
      This week: <strong>{formatPoints(points.points)}</strong> pts so far · {points.closed} closed
    </p>
  );
  // Shown only while there's something to process; it goes away once /mindscape has run.
  const intake = unprocessedDays > 0 && (
    <div className="today-intake">
      <span>
        {unprocessedDays} day{unprocessedDays === 1 ? '' : 's'} of notes not processed yet.
      </span>
      <button className="button primary small" onClick={onRunMindscape}>
        Run /mindscape
      </button>
    </div>
  );
  if (followUp.length === 0 && stale.length === 0 && due.length === 0) {
    return (
      <section className="today-panel quiet" aria-label="Today">
        {intake || <p className="muted">Nothing needs a nudge today.</p>}
        {week}
      </section>
    );
  }
  return (
    <section className="today-panel" aria-label="Today">
      {intake}
      {due.length > 0 && (
        <div className="today-group">
          <h3>Due soon</h3>
          <ul>
            {due.map((c) => (
              <li key={c.id}>
                <button className="link-button" onClick={() => onOpen(c.id)}>
                  {c.title}
                </button>
                <span className={`muted small ${dueState(c) === 'overdue' ? 'overdue' : ''}`}>{dueLabel(c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
      {week}
    </section>
  );
}
