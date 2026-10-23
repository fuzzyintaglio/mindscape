import { type MutableRefObject, type ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoredCard } from '../../core/cards.ts';
import type { WeekStrip } from '../../core/points.ts';
import { captureInsertion, formatDay } from '../../core/daily.ts';
import { merge3 } from '../../core/merge.ts';
import { type Meeting, addMeeting, currentOrNext, deleteMeeting, happeningAt, meetingsRange, parseMeetings, updateMeeting } from '../../core/meetings.ts';
import { MAX_PINS } from '../../core/pins.ts';
import { DAY_MS, toLocalDate } from '../../core/time.ts';
import { ApiError, api } from './api.ts';
import { onVaultChange } from './live.ts';
import type { EditorHandle } from './NotesEditor.tsx';
import { plainKey } from './keys.ts';
import { hrefFor, navigate } from './route.ts';
import { Calendar } from './Calendar.tsx';
import { MeetingFocus } from './MeetingFocus.tsx';
import { type PinProps, PinnedCards } from './PinnedCards.tsx';
import { Stickies } from './Stickies.tsx';
import { TodayStrip } from './TodayStrip.tsx';

const NotesEditor = lazy(() => import('./NotesEditor.tsx'));

/** Save this long after the last keystroke. */
const AUTOSAVE_MS = 700;

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

/** What the header's capture box needs from an open daily note. */
export interface OpenDaily {
  date: string;
  /** Put a captured line under "## Capture" in the editor, without moving the cursor. False if the editor isn't ready. */
  capture: (line: string) => boolean;
}

export function shiftDate(date: string, days: number): string {
  // Noon avoids daylight-saving edges.
  return toLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() + days * DAY_MS));
}

interface Props {
  date: string;
  /** Text to select and scroll to, e.g. from a search result. */
  find?: string;
  cards: StoredCard[];
  pins: PinProps;
  points: WeekStrip;
  /** Past daily notes /mindscape hasn't read yet. */
  unprocessedDays: number;
  onRunMindscape: () => void;
  onOpenCard: (id: string) => void;
  openDaily: MutableRefObject<OpenDaily | null>;
  /** The open card's panel, shown in the right column in place of the meeting. */
  cardPanel: ReactNode;
  openCardId: string | null;
  onCloseCard: () => void;
  /** Shown at the end of the header strip. */
  streaks?: ReactNode;
}

export function DailyPage({ date, find, cards, pins, points, unprocessedDays, onRunMindscape, onOpenCard, openDaily, cardPanel, openCardId, onCloseCard, streaks }: Props) {
  const today = toLocalDate();
  const [text, setText] = useState<string | null | undefined>(undefined); // undefined = loading, null = no note
  const [editorKey, setEditorKey] = useState(0);
  // The note as it is in the editor right now; the calendar and the meeting column read it.
  const [live, setLive] = useState('');
  const noteApi = useRef<NoteApi | null>(null);
  const meetings = useMemo(() => parseMeetings(live), [live]);
  const [focus, setFocus] = useState<number | null>(null);
  const now = useMinutes();
  const isToday = date === today;
  const nowHere = isToday ? now : null;

  const load = useCallback(async () => {
    setText(undefined);
    setFocus(null);
    try {
      const loaded = (await api.daily(date)).text;
      setText(loaded);
      setLive(loaded ?? '');
    } catch {
      setText(null);
      setLive('');
    }
    setEditorKey((k) => k + 1);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const created = (await api.daily(date, true)).text;
    setText(created);
    setLive(created ?? '');
    setEditorKey((k) => k + 1);
  };

  // ← → move between days when you're not typing (Esc leaves the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e) || document.querySelector('.modal') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if ((e.target as HTMLElement | null)?.closest?.('.panel-card, .cal-grid')) return;
      e.preventDefault();
      navigate(hrefFor.daily(shiftDate(date, e.key === 'ArrowLeft' ? -1 : 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date]);

  /** Change the note the way the calendar or meeting column asks, then focus the meeting it's about. */
  const edit = (fn: (text: string) => string, focusOn?: (m: Meeting) => boolean) => {
    if (!noteApi.current?.apply(fn)) return;
    if (focusOn) setFocus(parseMeetings(fn(live)).findIndex(focusOn));
  };

  // The right column: the meeting you clicked, else the one happening now (or next, or the first).
  const auto = isToday ? currentOrNext(meetings, now) : meetings.length ? 0 : null;
  const shown = focus !== null && meetings[focus] ? focus : auto;
  const order = meetings.map((m, i) => ({ m, i })).sort((a, b) => a.m.start - b.m.start).map((x) => x.i);
  const at = shown === null ? -1 : order.indexOf(shown);
  const whenOf = (m: Meeting) =>
    !isToday ? formatDay(date, 'dddd') : m.start <= now && m.end > now ? 'Happening now' : m.start > now ? (focus === null ? 'Up next' : 'Later today') : 'Earlier today';

  // A meeting that starts while a card is open gets a line above the card instead of replacing it.
  const opened = useRef<{ id: string; meeting: number | null; at: number } | null>(null);
  if (openCardId && opened.current?.id !== openCardId) opened.current = { id: openCardId, meeting: happeningAt(meetings, now), at: now };
  if (!openCardId) opened.current = null;
  const startedIdx = openCardId && isToday ? happeningAt(meetings, now) : null;
  const started = startedIdx !== null && startedIdx !== opened.current?.meeting && meetings[startedIdx]!.start >= (opened.current?.at ?? 0) ? startedIdx : null;
  const back = shown !== null ? meetings[shown] : null;

  const due = cards.filter((c) => c.due && c.status !== 'complete' && c.due <= date && (isToday || c.due === date));
  const title = isToday ? 'Today' : formatDay(date, 'dddd');

  return (
    <div className="daily-page home">
      <header className="daily-header">
        <div className="day-nav">
          <a className="icon-button" href={hrefFor.daily(shiftDate(date, -1))} aria-label="Previous day" title="Previous day">
            ←
          </a>
          <h2>
            {title} <span className="muted">{formatDay(date, 'MMMM D, YYYY')}</span>
          </h2>
          <a className="icon-button" href={hrefFor.daily(shiftDate(date, 1))} aria-label="Next day" title="Next day">
            →
          </a>
        </div>
        <div className="day-tools">
          {!isToday && (
            <a className="button quiet" href={hrefFor.daily(today)}>
              Go to today
            </a>
          )}
          <input
            type="date"
            className="date-picker"
            aria-label="Pick a day"
            value={date}
            onChange={(e) => e.target.value && navigate(hrefFor.daily(e.target.value))}
          />
        </div>
      </header>

      {isToday && (
        <TodayStrip cards={cards} points={points} unprocessedDays={unprocessedDays} onRunMindscape={onRunMindscape} onOpen={onOpenCard}>
          {streaks}
        </TodayStrip>
      )}

      <div className="home-grid">
        <aside className="home-left">
          {isToday && (
            <>
              <h3 className="col-title">
                Today’s priorities <span className="col-sub">{pins.pinned.length} of {MAX_PINS} pinned</span>
              </h3>
              <PinnedCards cards={cards} {...pins} onOpen={onOpenCard} />
            </>
          )}
          <h3 className="col-title">
            Stickies <span className="col-sub">not part of the note</span>
          </h3>
          <Stickies date={date} />
        </aside>

        <section className="home-middle">
          <Calendar
            meetings={meetings}
            focused={openCardId ? null : shown}
            now={nowHere}
            due={due}
            editable={typeof text === 'string'}
            onOpenCard={onOpenCard}
            onFocus={(i) => {
              if (openCardId) onCloseCard();
              setFocus(i);
            }}
            onAdd={(m) => {
              if (openCardId) onCloseCard();
              edit((t) => addMeeting(t, m), (x) => x.start === m.start && x.title === m.title);
            }}
            onReschedule={(i, start) => {
              const m = meetings[i]!;
              const end = start + (m.end - m.start);
              edit((t) => updateMeeting(t, i, { start, end }), (x) => x.start === start && x.title === m.title);
            }}
          />
          <h3 className="col-title">Daily note</h3>
          {text === undefined && <p className="muted">Loading…</p>}
          {text === null && (
            <div className="empty-day">
              <p className="muted">No note for {formatDay(date, 'dddd, MMMM D')}.</p>
              <button className="button primary" onClick={() => void create()}>
                Create note
              </button>
            </div>
          )}
          {typeof text === 'string' && (
            <DailyEditor key={`${date}-${editorKey}`} date={date} find={find} initial={text} openDaily={openDaily} onText={setLive} noteApi={noteApi} />
          )}
        </section>

        <aside className="home-right">
          {cardPanel ? (
            <>
              <h3 className="col-title">Card</h3>
              <button className="backlink" onClick={onCloseCard}>
                ← Back to {back ? back.title : 'meetings'}
              </button>
              {started !== null && (
                <div className="meeting-started" role="status">
                  <span>
                    <strong>{meetings[started]!.title}</strong> started {now - meetings[started]!.start ? `${now - meetings[started]!.start} min ago` : 'just now'}
                  </span>
                  <button
                    className="button quiet small"
                    onClick={() => {
                      onCloseCard();
                      setFocus(started);
                    }}
                  >
                    Switch
                  </button>
                </div>
              )}
              {cardPanel}
            </>
          ) : (
            <>
              <h3 className="col-title">Meeting</h3>
              {shown !== null && meetings[shown] ? (
                <MeetingFocus
                  key={`${date}-${shown}`}
                  meeting={meetings[shown]!}
                  when={whenOf(meetings[shown]!)}
                  prev={at > 0 ? meetings[order[at - 1]!]!.title : null}
                  next={at >= 0 && at < order.length - 1 ? meetings[order[at + 1]!]!.title : null}
                  onPrev={() => setFocus(order[at - 1]!)}
                  onNext={() => setFocus(order[at + 1]!)}
                  onChange={(patch) => edit((t) => updateMeeting(t, shown, patch))}
                  onDelete={() => {
                    edit((t) => deleteMeeting(t, shown));
                    setFocus(null);
                  }}
                />
              ) : (
                <p className="muted empty-meetings">{typeof text === 'string' ? 'No more meetings today. Click the calendar to add one.' : 'No note for this day yet.'}</p>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Minutes since midnight, kept current. */
function useMinutes(): number {
  const read = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const t = window.setInterval(() => setNow(read()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/**
 * Always-editable daily note. Saves on its own shortly after you stop typing. If the
 * file changes elsewhere (a capture from the CLI, an edit in Obsidian), those changes
 * are merged into what you're typing; only overlapping edits ask you to choose.
 */
/** Lets the Today view change the note (e.g. the calendar adding a meeting) as if you'd typed it. */
export interface NoteApi {
  /** Replace the note with `fn(current text)`; saved like typing. False if the editor isn't ready. */
  apply(fn: (text: string) => string): boolean;
}

function DailyEditor({
  date,
  find,
  initial,
  openDaily,
  onText,
  noteApi,
}: {
  date: string;
  find?: string;
  initial: string;
  openDaily: MutableRefObject<OpenDaily | null>;
  /** The editor's text, after every change. */
  onText: (text: string) => void;
  noteApi: MutableRefObject<NoteApi | null>;
}) {
  const editor = useRef<EditorHandle | null>(null);
  const synced = useRef(initial); // the file's text, as far as we know
  const doc = useRef(initial); // the editor's text
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<number>();
  const applying = useRef(false); // true while the page itself changes the editor text
  const [state, setState] = useState<SaveState>('saved');
  const [theirs, setTheirs] = useState<string | null>(null);

  /** Replace the editor text (keeping the cursor) and remember it. */
  const show = (next: string) => {
    if (next === doc.current) return;
    applying.current = true;
    editor.current?.setText(next);
    applying.current = false;
    doc.current = next;
  };

  const save = useCallback(
    async (force = false) => {
      window.clearTimeout(timer.current);
      if (saving.current) {
        again.current = true;
        return;
      }
      if (doc.current === synced.current && !force) {
        setState('saved');
        return;
      }
      const sent = doc.current;
      saving.current = true;
      setState('saving');
      try {
        const { text: written } = await api.saveDaily(date, sent, synced.current, force);
        synced.current = written;
        if (doc.current === sent) show(written);
        else {
          // You kept typing while it saved: fold the saved result into the newer text.
          const merged = merge3(sent, doc.current, written);
          if (merged.ok) show(merged.text);
        }
        setTheirs(null);
        setState(doc.current === synced.current ? 'saved' : 'unsaved');
        if (doc.current !== synced.current) again.current = true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setTheirs(String(err.body.text ?? ''));
          setState('conflict');
        } else {
          setState('error');
          timer.current = window.setTimeout(() => void save(), 5000);
        }
      } finally {
        saving.current = false;
        if (again.current) {
          again.current = false;
          void save();
        }
      }
    },
    // `show` only touches refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date],
  );

  const schedule = useCallback(() => {
    setState((s) => (s === 'conflict' ? s : 'unsaved'));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save]);

  const onChange = (next: string) => {
    doc.current = next;
    onText(next);
    if (!applying.current && theirs === null) schedule();
  };

  /** Fold the Meetings section: the calendar shows it. */
  const foldMeetings = () => {
    const r = meetingsRange(doc.current);
    editor.current?.unfold();
    if (r) editor.current?.fold(r.from, r.to);
  };

  useEffect(() => {
    noteApi.current = {
      apply: (fn) => {
        if (!editor.current) return false;
        const wasFolded = editor.current.folded();
        show(fn(doc.current));
        schedule();
        if (wasFolded) foldMeetings();
        return true;
      },
    };
    return () => {
      noteApi.current = null;
    };
    // `show` and `foldMeetings` only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteApi, schedule]);

  // Pick up changes made elsewhere while the note is open.
  useEffect(
    () =>
      onVaultChange(async () => {
        if (saving.current) return; // the save's reply brings the latest text
        let disk: string | null;
        try {
          disk = (await api.daily(date)).text;
        } catch {
          return;
        }
        if (disk === null || disk === synced.current || saving.current) return;
        if (doc.current === synced.current) {
          show(disk);
          synced.current = disk;
          return;
        }
        const merged = merge3(synced.current, doc.current, disk);
        if (merged.ok) {
          show(merged.text);
          synced.current = disk;
          schedule();
        } else {
          setTheirs(disk);
          setState('conflict');
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, schedule],
  );

  // Let the header's capture box write into this note while it's open.
  useEffect(() => {
    openDaily.current = {
      date,
      capture: (line) => {
        if (!editor.current) return false;
        const { at, insert } = captureInsertion(doc.current, line);
        editor.current.insert(at, insert);
        void save();
        return true;
      },
    };
    return () => {
      if (openDaily.current?.date === date) openDaily.current = null;
    };
  }, [date, openDaily, save]);

  // Leaving the page or switching days: save what's left right away.
  useEffect(() => {
    const flush = () => {
      if (doc.current !== synced.current && !saving.current) {
        void fetch(`/api/daily/${date}`, {
          method: 'PUT',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: doc.current, base: synced.current }),
        }).catch(() => {});
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (doc.current !== synced.current) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.clearTimeout(timer.current);
      flush();
    };
  }, [date]);

  // A new search result on the same day: jump to it in the open editor.
  const firstFind = useRef(find);
  useEffect(() => {
    if (find && find !== firstFind.current) editor.current?.find(find);
    firstFind.current = undefined;
  }, [find]);

  const resolve = (keep: 'mine' | 'theirs') => {
    if (keep === 'theirs' && theirs !== null) {
      show(theirs);
      synced.current = theirs;
      setState('saved');
    } else void save(true);
    setTheirs(null);
  };

  return (
    <div className="daily-editor-wrap">
      <div className="save-state" data-state={state} aria-live="polite">
        {SAVE_LABELS[state]}
      </div>
      {theirs !== null && (
        <div className="conflict">
          <p>This note changed somewhere else, in the same place you were typing.</p>
          <div className="row-actions">
            <button className="button quiet" onClick={() => resolve('theirs')}>
              Use theirs
            </button>
            <button className="button primary" onClick={() => resolve('mine')}>
              Keep mine
            </button>
          </div>
        </div>
      )}
      <Suspense fallback={<p className="muted">Opening editor…</p>}>
        <NotesEditor
          className="daily-editor"
          initial={initial}
          onChange={onChange}
          onSave={() => void save()}
          onCancel={() => {
            // Esc leaves the editor (it saves on its own), so single-key shortcuts work again.
            void save();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
          handleRef={editor}
          autoFocus={false}
          initialFind={find}
          placeholder="Type anything. It saves as you go."
          onReady={() => !find && foldMeetings()}
          preview
          onOpenNote={(name) => navigate(hrefFor.note(name))}
        />
      </Suspense>
    </div>
  );
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Editing…',
  saving: 'Saving…',
  error: 'Couldn’t save — retrying',
  conflict: 'Not saved',
};
