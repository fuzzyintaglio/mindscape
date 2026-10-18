import { useCallback, useEffect, useState } from 'react';
import { formatDay } from '../../core/daily.ts';
import { currentWeek, formatPoints, shiftWeek, weekStart } from '../../core/points.ts';
import { ApiError, type Review, type ReviewSummary, type WeekPoints, api } from './api.ts';
import { EditableMarkdown, type SaveOutcome } from './EditableMarkdown.tsx';
import { onVaultChange } from './live.ts';
import { Markdown } from './Markdown.tsx';
import { hrefFor } from './route.ts';
import { useToast } from './Toasts.tsx';

/** How many weeks the History chart shows. */
const CHART_WEEKS = 26;

const weekLabel = (week: string) => `Week of ${formatDay(weekStart(week), 'MMM D, YYYY')}`;

/** Weekly points as bars, newest on the right. The current week is "so far"; the best week is marked. */
export function HistoryChart({ history }: { history: WeekPoints[] }) {
  const weeks = history.slice(-CHART_WEEKS);
  const max = Math.max(...weeks.map((w) => w.points), 1);
  const best = Math.max(...history.filter((w) => !w.current).map((w) => w.points), 0);
  const W = 640;
  const H = 150;
  const top = 18;
  const bottom = 22;
  const slot = W / Math.max(weeks.length, 8);
  const bar = Math.min(34, slot * 0.7);
  return (
    <svg className="history-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly points">
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="axis" />
      {weeks.map((w, i) => {
        const h = w.points ? Math.max(3, ((H - top - bottom) * w.points) / max) : 0;
        const x = i * slot + (slot - bar) / 2;
        const y = H - bottom - h;
        const isBest = !w.current && best > 0 && w.points === best;
        const showDate = weeks.length <= 10 || i % Math.ceil(weeks.length / 8) === 0 || w.current;
        return (
          <g key={w.week} className={`week-bar ${w.current ? 'current' : ''} ${isBest ? 'best' : ''}`}>
            <title>
              {`${weekLabel(w.week)}: ${formatPoints(w.points)} pts · ${w.closed} closed${w.current ? ' (so far)' : ''}`}
            </title>
            <a href={w.current ? hrefFor.reviews() : hrefFor.review(w.week)} aria-label={`${weekLabel(w.week)}, ${formatPoints(w.points)} points`}>
              <rect x={x} y={top} width={bar} height={H - top - bottom} className="hit" />
              <rect x={x} y={y} width={bar} height={h} rx="3" className="fill" />
            </a>
            {w.points > 0 && (weeks.length <= 12 || isBest || w.current) && (
              <text x={x + bar / 2} y={y - 5} textAnchor="middle" className="value">
                {isBest ? '★ ' : ''}
                {formatPoints(w.points)}
              </text>
            )}
            {showDate && (
              <text x={x + bar / 2} y={H - 6} textAnchor="middle" className="date">
                {w.current ? 'now' : formatDay(weekStart(w.week), 'MMM D')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Points over time, and every weekly review. */
export function ReviewsPage() {
  const toast = useToast();
  const [data, setData] = useState<{ reviews: ReviewSummary[]; history: WeekPoints[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.reviews());
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    void load();
    return onVaultChange(() => void load());
  }, [load]);

  if (!data) return <p className="muted">Loading…</p>;
  const now = data.history.find((w) => w.current);
  const done = data.history.filter((w) => !w.current);

  return (
    <div className="reviews-page">
      <header className="page-header">
        <h2>Weekly reviews</h2>
        {now && (
          <span className="muted small">
            This week so far: <strong>{formatPoints(now.points)}</strong> pts · {now.closed} closed
          </span>
        )}
      </header>
      <section className="history" aria-label="History">
        <h3>History</h3>
        {done.length || now?.points ? <HistoryChart history={data.history} /> : <p className="muted small">Your weekly points chart starts filling in as you complete cards.</p>}
      </section>
      <section aria-label="Reviews">
        <h3>Reviews</h3>
        <p className="muted small">Each week’s review is written the first time Mindscape runs after the week ends (Sunday night), and saved in your vault under reviews/.</p>
        {data.reviews.length === 0 && (
          <p className="muted">No reviews yet. The first one appears next Monday.</p>
        )}
        <ul className="review-list">
          {data.reviews.map((r) => (
            <li key={r.week}>
              <a href={hrefFor.review(r.week)}>
                <span>{weekLabel(r.week)}</span>
                <span className="muted small">
                  {formatPoints(r.points)} pts · {r.closed} closed
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** One week's review, with its Reflection editable in place. */
export function ReviewPage({ week, onDirtyChange }: { week: string; onDirtyChange: (dirty: boolean) => void }) {
  const toast = useToast();
  const [review, setReview] = useState<Review | null | undefined>(undefined); // null = not written
  const [busy, setBusy] = useState(false);
  const finished = week < currentWeek();

  const load = useCallback(async () => {
    try {
      setReview((await api.review(week)).review);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setReview(null);
      else toast({ message: (err as Error).message, tone: 'error' });
    }
  }, [week, toast]);

  useEffect(() => {
    setReview(undefined);
    void load();
    return onVaultChange(() => void load());
  }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      await api.writeReview(week);
      await load();
      toast({ message: review ? 'Review rewritten. Your reflection was kept.' : 'Review written.' });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const saveReflection = async (draft: string, base: string | undefined): Promise<SaveOutcome> => {
    try {
      const { reflection } = await api.saveReflection(week, draft, base ?? '');
      setReview((r) => (r ? { ...r, reflection } : r));
      return 'saved';
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return 'conflict';
      toast({ message: (err as Error).message, tone: 'error' });
      return 'failed';
    }
  };

  return (
    <div className="review-page">
      <header className="page-header">
        <div className="day-nav">
          <a className="icon-button" href={hrefFor.review(shiftWeek(week, -1))} aria-label="Previous week" title="Previous week">
            ←
          </a>
          <h2>{weekLabel(week)}</h2>
          {shiftWeek(week, 1) < currentWeek() ? (
            <a className="icon-button" href={hrefFor.review(shiftWeek(week, 1))} aria-label="Next week" title="Next week">
              →
            </a>
          ) : (
            <span className="icon-button disabled" aria-hidden="true">
              →
            </span>
          )}
        </div>
        <div className="row-actions">
          <a className="button quiet" href={hrefFor.reviews()}>
            All reviews
          </a>
          {finished && review !== undefined && (
            <button
              className={`button ${review ? 'bordered' : 'primary'}`}
              disabled={busy}
              onClick={() => void generate()}
              title={review ? 'Recount this week from your cards. Your reflection is kept.' : undefined}
            >
              {review ? 'Regenerate' : 'Write this review'}
            </button>
          )}
        </div>
      </header>
      {review === undefined && <p className="muted">Loading…</p>}
      {review === null && <p className="muted">{finished ? 'No review for this week yet.' : 'This week isn’t over yet. Its review is written after Sunday.'}</p>}
      {review && (
        <>
          <Markdown text={review.body.replace(/^# .*\n+/, '')} className="review-body" />
          <section className="review-reflection" aria-label="Reflection">
            <h2>Reflection</h2>
            <EditableMarkdown
              key={week}
              text={review.reflection}
              onSave={saveReflection}
              onDirtyChange={onDirtyChange}
              placeholder="Click to write: what went well, what got in the way, what to change next week…"
              label="Reflection"
            />
          </section>
          <footer className="panel-footer">
            <span className="muted small">{review.path}</span>
          </footer>
        </>
      )}
    </div>
  );
}
