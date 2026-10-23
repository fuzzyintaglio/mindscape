import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import { type StoredCard, dueState } from '../../core/cards.ts';
import { type Meeting, clock } from '../../core/meetings.ts';

const HOUR_PX = 56;
const DAY_START = 8 * 60;
const DAY_END = 17 * 60;
const SNAP = 15;

/** "9am", "1:30pm" */
export function time12(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 || h === 24 ? 'am' : 'pm'}`;
}

/** Side-by-side columns for meetings that overlap. */
function layout(meetings: Meeting[]): Map<number, { col: number; cols: number }> {
  const order = meetings.map((m, i) => ({ m, i })).sort((a, b) => a.m.start - b.m.start || a.m.end - b.m.end);
  const out = new Map<number, { col: number; cols: number }>();
  let group: typeof order = [];
  let groupEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    for (const { m, i } of group) {
      let col = ends.findIndex((end) => end <= m.start);
      if (col < 0) col = ends.push(0) - 1;
      ends[col] = m.end;
      out.set(i, { col, cols: 0 });
    }
    for (const { i } of group) out.get(i)!.cols = ends.length;
    group = [];
  };
  for (const item of order) {
    if (item.m.start >= groupEnd) {
      flush();
      groupEnd = item.m.end;
    } else groupEnd = Math.max(groupEnd, item.m.end);
    group.push(item);
  }
  flush();
  return out;
}

interface Props {
  meetings: Meeting[];
  focused: number | null;
  /** Minutes since midnight, for the "now" line (today only). */
  now: number | null;
  /** Cards for the all-day row: due today, or overdue. */
  due: StoredCard[];
  editable: boolean;
  onOpenCard: (id: string) => void;
  onFocus: (index: number) => void;
  onAdd: (meeting: { start: number; end: number; title: string }) => void;
  onReschedule: (index: number, start: number) => void;
}

/** A one-day calendar over the note's Meetings section: click to add, drag to reschedule, click a meeting to focus it. */
export function Calendar({ meetings, focused, now, due, editable, onOpenCard, onFocus, onAdd, onReschedule }: Props) {
  // 8am–5pm, stretched to fit any meeting outside those hours.
  const first = Math.min(DAY_START, ...meetings.map((m) => Math.floor(m.start / 60) * 60));
  const last = Math.max(DAY_END, ...meetings.map((m) => Math.ceil(m.end / 60) * 60));
  const y = (minutes: number) => ((minutes - first) / 60) * HOUR_PX;
  const grid = useRef<HTMLDivElement>(null);
  const positions = useMemo(() => layout(meetings), [meetings]);
  const [adding, setAdding] = useState<number | null>(null);
  const [moving, setMoving] = useState<{ index: number; start: number } | null>(null);
  const [drag, setDrag] = useState<{ index: number; start: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragged = useRef(false);

  /** The time at a point on the grid, snapped to `step` minutes. */
  const timeAt = (clientY: number, step: number) => {
    const top = grid.current!.getBoundingClientRect().top;
    const raw = first + ((clientY - top) / HOUR_PX) * 60;
    return Math.min(Math.max(Math.round(raw / step) * step, first), last - 30);
  };

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (!editable || e.button !== 0) return;
    const m = meetings[index]!;
    const from = e.clientY;
    const length = m.end - m.start;
    dragged.current = false;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let start = m.start;
    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.abs(ev.clientY - from) < 4) return;
      dragged.current = true;
      start = Math.min(Math.max(Math.round((m.start + ((ev.clientY - from) / HOUR_PX) * 60) / SNAP) * SNAP, first), last - length);
      setDrag({ index, start });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!dragged.current) onFocus(index);
      else if (start !== m.start) setMoving({ index, start });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const hours = [];
  for (let t = first; t <= last; t += 30) hours.push(t);

  return (
    <section className="calendar" aria-label="Calendar">
      <div className="allday">
        <span className="allday-label">Due today</span>
        {due.length ? (
          due.map((c) => {
            const overdue = dueState(c) === 'overdue';
            return (
              <button key={c.id} className={`due-chip ${overdue ? 'overdue' : ''}`} onClick={() => onOpenCard(c.id)} title={overdue ? 'Overdue' : 'Due today'}>
                {overdue && 'Overdue · '}
                {c.title}
              </button>
            );
          })
        ) : (
          <span className="muted small">Nothing due today.</span>
        )}
      </div>
      <div
        className={`cal-grid ${editable ? 'editable' : ''}`}
        ref={grid}
        style={{ height: y(last) }}
        onMouseMove={(e) => editable && !(e.target as HTMLElement).closest('.cal-meeting') && setHover(timeAt(e.clientY, 30))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (!editable || (e.target as HTMLElement).closest('.cal-meeting')) return;
          setAdding(timeAt(e.clientY, 30));
        }}
      >
        {hours.map((t) => (
          <div key={t} className={`cal-line ${t % 60 ? 'half' : ''}`} style={{ top: y(t) }}>
            {t % 60 === 0 && <span className="cal-hour">{time12(t)}</span>}
          </div>
        ))}
        {hover !== null && !drag && (
          <div className="cal-ghost" style={{ top: y(hover) }} aria-hidden>
            + {time12(hover)}
          </div>
        )}
        {now !== null && now >= first && now <= last && <div className="cal-now" style={{ top: y(now) }} aria-label={`Now, ${time12(now)}`} />}
        {meetings.map((m, i) => {
          const pos = positions.get(i)!;
          const start = drag?.index === i ? drag.start : m.start;
          const end = start + (m.end - m.start);
          const short = m.end - m.start < 45;
          const lines = m.notes.split('\n').filter((l) => l.trim()).length;
          return (
            <button
              key={`${i}-${m.start}-${m.title}`}
              className={`cal-meeting ${focused === i ? 'focus' : ''} ${short ? 'short' : ''} ${now !== null && m.end <= now ? 'past' : ''} ${drag?.index === i ? 'dragging' : ''}`}
              style={{
                top: y(start) + 1,
                height: Math.max(y(end) - y(start) - 2, 20),
                left: `calc(${(pos.col / pos.cols) * 100}% + 4px)`,
                width: `calc(${100 / pos.cols}% - 8px)`,
              }}
              aria-label={`${m.title}, ${time12(m.start)} to ${time12(m.end)}`}
              onPointerDown={(e) => startDrag(e, i)}
              onKeyDown={(e) => e.key === 'Enter' && onFocus(i)}
            >
              <span className="cal-title">{m.title || 'Untitled'}</span>
              <span className="cal-time">
                {time12(start)}–{time12(end)}
              </span>
              {!short && lines > 0 && m.end - m.start >= 60 && (
                <span className="cal-notes">
                  {lines} note line{lines === 1 ? '' : 's'}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {adding !== null && (
        <NewMeeting
          start={adding}
          onCancel={() => setAdding(null)}
          onAdd={(m) => {
            setAdding(null);
            onAdd(m);
          }}
        />
      )}
      {moving && (
        <ConfirmReschedule
          meeting={meetings[moving.index]!}
          start={moving.start}
          onCancel={() => setMoving(null)}
          onConfirm={() => {
            onReschedule(moving.index, moving.start);
            setMoving(null);
          }}
        />
      )}
    </section>
  );
}

const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
};

/** Start time guessed from where you clicked, end 30 minutes later, and a title. */
function NewMeeting({ start, onCancel, onAdd }: { start: number; onCancel: () => void; onAdd: (m: { start: number; end: number; title: string }) => void }) {
  const [from, setFrom] = useState(clock(start));
  const [to, setTo] = useState(clock(start + 30));
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const s = toMinutes(from);
    const e = toMinutes(to);
    if (!title.trim()) return setError('Give it a title.');
    if (!(e > s)) return setError('The end has to be after the start.');
    onAdd({ start: s, end: e, title: title.trim() });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-meeting-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
      >
        <h2 id="new-meeting-title">New meeting</h2>
        <div className="time-pair">
          <label className="field">
            <span className="field-label">Starts</span>
            <input type="time" step={900} value={from} onChange={(e) => (setFrom(e.target.value), setError(''))} />
          </label>
          <label className="field">
            <span className="field-label">Ends</span>
            <input type="time" step={900} value={to} onChange={(e) => (setTo(e.target.value), setError(''))} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Title</span>
          <input autoFocus value={title} placeholder="Design review" onChange={(e) => (setTitle(e.target.value), setError(''))} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="row-actions end">
          <button className="button quiet" onClick={onCancel}>
            Cancel
          </button>
          <button className="button primary" onClick={save}>
            Add meeting
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmReschedule({ meeting, start, onCancel, onConfirm }: { meeting: Meeting; start: number; onCancel: () => void; onConfirm: () => void }) {
  const end = start + (meeting.end - meeting.start);
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2 id="reschedule-title">Confirm reschedule?</h2>
        <p className="modal-sub">
          Move <strong>{meeting.title}</strong> from {time12(meeting.start)}–{time12(meeting.end)} to{' '}
          <strong>
            {time12(start)}–{time12(end)}
          </strong>
          ?
        </p>
        <div className="row-actions end">
          <button className="button quiet" onClick={onCancel}>
            Keep original time
          </button>
          <button className="button primary" autoFocus onClick={onConfirm}>
            Reschedule
          </button>
        </div>
      </div>
    </div>
  );
}
