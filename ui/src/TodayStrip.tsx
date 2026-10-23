import { type ReactNode, useEffect, useRef, useState } from 'react';
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
  /** Extra items at the end, e.g. streaks. */
  children?: ReactNode;
}

type Group = 'due' | 'follow' | 'quiet';

/** The Today view's header: what needs a nudge, as chips that open short lists, and this week's points. */
export function TodayStrip({ cards, points, unprocessedDays, onRunMindscape, onOpen, children }: Props) {
  const { followUp, stale, due } = briefing(cards);
  const [open, setOpen] = useState<Group | null>(null);
  const strip = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !strip.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const lists: Record<Group, { label: string; tone: string; rows: { card: StoredCard; note: string; overdue?: boolean }[] }> = {
    due: { label: 'due soon', tone: due.some((c) => dueState(c) === 'overdue') ? 'danger' : 'warn', rows: due.map((c) => ({ card: c, note: dueLabel(c) ?? '', overdue: dueState(c) === 'overdue' })) },
    follow: {
      label: 'follow up',
      tone: 'danger',
      rows: followUp.map((c) => ({ card: c, note: `${c.blockedBy ? `Waiting on ${c.blockedBy} · ` : ''}expected ${formatDate(c.unblockBy!)}` })),
    },
    quiet: { label: 'gone quiet', tone: 'warn', rows: stale.map((c) => ({ card: c, note: `In Progress, untouched ${daysUntouched(c)} days` })) },
  };
  const groups = (['due', 'follow', 'quiet'] as Group[]).filter((g) => lists[g].rows.length);

  return (
    <section className="today-strip" aria-label="Today" ref={strip}>
      {groups.map((g) => (
        <span key={g} className="strip-item">
          <button className={`strip-chip ${lists[g].tone}`} aria-expanded={open === g} onClick={() => setOpen(open === g ? null : g)}>
            <strong>{lists[g].rows.length}</strong> {lists[g].label}
          </button>
          {open === g && (
            <div className="strip-pop" role="list">
              {lists[g].rows.map(({ card, note, overdue }) => (
                <button
                  key={card.id}
                  role="listitem"
                  className="strip-row"
                  onClick={() => {
                    setOpen(null);
                    onOpen(card.id);
                  }}
                >
                  <span>{card.title}</span>
                  <span className={`muted small ${overdue ? 'overdue' : ''}`}>{note}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ))}
      {groups.length === 0 && <span className="muted small">Nothing needs a nudge today.</span>}
      {unprocessedDays > 0 && (
        <button className="strip-chip accent" onClick={onRunMindscape} title="Opens Claude Code in Terminal">
          {unprocessedDays} day{unprocessedDays === 1 ? '' : 's'} of notes not processed → Run /mindscape
        </button>
      )}
      <span className="strip-sep" aria-hidden />
      <span className="strip-points">
        This week <strong>{formatPoints(points.points)}</strong> pts so far · {points.closed} closed
      </span>
      {children}
    </section>
  );
}
