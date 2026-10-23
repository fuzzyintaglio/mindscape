import { type WeekStrip, formatPoints } from '../../core/points.ts';
import type { Streaks as StreakCounts } from '../../core/streaks.ts';
import { hrefFor } from './route.ts';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** True when this week beats every earlier week (and there was an earlier week to beat). */
export const isBestWeek = (s: WeekStrip) => s.best > 0 && s.points > s.best;

/** "This week: 2,450 pts · 9 closed" with a tiny bar per day. Opens the weekly reviews. */
export function PointsStrip({ strip, streaks }: { strip: WeekStrip; streaks?: StreakCounts }) {
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
      {streaks && <Streaks streaks={streaks} compact />}
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

const STREAK_HELP = 'Weekdays in a row. Weekends never break a streak, and today counts once you do it.';

/** The three streaks: Quick Capture, writing in the daily note, and moving a card forward. */
export function Streaks({ streaks, compact = false }: { streaks: StreakCounts; compact?: boolean }) {
  const items = [
    { key: 'capture', label: 'Capture', value: streaks.capture, help: 'days with a Quick Capture' },
    { key: 'daily', label: 'Daily note', value: streaks.daily, help: 'days writing in the daily note' },
    { key: 'progress', label: 'Progress', value: streaks.progress, help: 'days moving a card forward' },
  ];
  return (
    <span className={`streaks ${compact ? 'compact' : ''}`} title={`${items.map((i) => `${i.label}: ${i.value} ${i.help}`).join('\n')}\n${STREAK_HELP}`}>
      {items.map((i) => (
        <span key={i.key} className={`streak ${i.value ? 'on' : ''}`} aria-label={`${i.label} streak: ${i.value}`}>
          {i.key === 'progress' && <span className="flame" aria-hidden>🔥</span>}
          {!compact && <span className="streak-label">{i.label}</span>}
          {compact && i.key !== 'progress' && <span className="streak-label">{i.key === 'capture' ? '✎' : '✍'}</span>}
          <strong>{i.value}</strong>
        </span>
      ))}
    </span>
  );
}
