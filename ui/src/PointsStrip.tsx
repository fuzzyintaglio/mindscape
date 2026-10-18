import { type WeekStrip, formatPoints } from '../../core/points.ts';
import { hrefFor } from './route.ts';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** True when this week beats every earlier week (and there was an earlier week to beat). */
export const isBestWeek = (s: WeekStrip) => s.best > 0 && s.points > s.best;

/** "This week: 2,450 pts · 9 closed" with a tiny bar per day. Opens the weekly reviews. */
export function PointsStrip({ strip }: { strip: WeekStrip }) {
  const max = Math.max(...strip.days, 1);
  const today = (new Date().getDay() + 6) % 7;
  const best = isBestWeek(strip);
  return (
    <a
      className={`points-strip ${best ? 'best' : ''}`}
      href={hrefFor.reviews()}
      title={best ? 'Your best week yet — open weekly reviews' : 'Open weekly reviews'}
    >
      <span className="points-text">
        <span className="muted">This week:</span> <strong>{formatPoints(strip.points)}</strong> pts · {strip.closed} closed
        {best && <span className="best-tag">★ Best week</span>}
      </span>
      <span className="points-bars" aria-hidden="true">
        {strip.days.map((n, i) => (
          <span
            key={i}
            className={`points-bar ${i === today ? 'today' : ''} ${i > today ? 'later' : ''}`}
            style={{ height: `${n ? Math.max(18, (n / max) * 100) : 8}%` }}
            title={`${DAY_NAMES[i]}: ${formatPoints(n)} pts`}
          />
        ))}
      </span>
    </a>
  );
}
