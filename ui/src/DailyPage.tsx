import { type MutableRefObject, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { StoredCard } from '../../core/cards.ts';
import { captureInsertion, formatDay } from '../../core/daily.ts';
import { merge3 } from '../../core/merge.ts';
import { DAY_MS, toLocalDate } from '../../core/time.ts';
import { ApiError, api } from './api.ts';
import { onVaultChange } from './live.ts';
import type { EditorHandle } from './NotesEditor.tsx';
import { hrefFor, navigate } from './route.ts';
import { TodayPanel } from './TodayPanel.tsx';

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
  cards: StoredCard[];
  onOpenCard: (id: string) => void;
  openDaily: MutableRefObject<OpenDaily | null>;
}

export function DailyPage({ date, cards, onOpenCard, openDaily }: Props) {
  const today = toLocalDate();
  const [text, setText] = useState<string | null | undefined>(undefined); // undefined = loading, null = no note
  const [editorKey, setEditorKey] = useState(0);

  const load = useCallback(async () => {
    setText(undefined);
    try {
      setText((await api.daily(date)).text);
    } catch {
      setText(null);
    }
    setEditorKey((k) => k + 1);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setText((await api.daily(date, true)).text);
    setEditorKey((k) => k + 1);
  };

  const isToday = date === today;
  const title = isToday ? 'Today' : formatDay(date, 'dddd');

  return (
    <div className="daily-page">
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

      {isToday && <TodayPanel cards={cards} onOpen={onOpenCard} />}

      {text === undefined && <p className="muted">Loading…</p>}
      {text === null && (
        <div className="empty-day">
          <p className="muted">No note for {formatDay(date, 'dddd, MMMM D')}.</p>
          <button className="button primary" onClick={() => void create()}>
            Create note
          </button>
        </div>
      )}
      {typeof text === 'string' && <DailyEditor key={`${date}-${editorKey}`} date={date} initial={text} openDaily={openDaily} />}
    </div>
  );
}

/**
 * Always-editable daily note. Saves on its own shortly after you stop typing. If the
 * file changes elsewhere (a capture from the CLI, an edit in Obsidian), those changes
 * are merged into what you're typing; only overlapping edits ask you to choose.
 */
function DailyEditor({ date, initial, openDaily }: { date: string; initial: string; openDaily: MutableRefObject<OpenDaily | null> }) {
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
    if (!applying.current && theirs === null) schedule();
  };

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
          handleRef={editor}
          autoFocus={false}
          placeholder="Type anything. It saves as you go."
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
