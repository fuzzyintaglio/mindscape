import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Meeting } from '../../core/meetings.ts';
import { time12 } from './Calendar.tsx';

const INDENT = '    ';

interface Props {
  meeting: Meeting;
  /** "Happening now", "Up next", "Later today", "Earlier today". */
  when: string;
  prev: string | null;
  next: string | null;
  onChange: (patch: Partial<Meeting>) => void;
  onDelete: () => void;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * The focused meeting, editable: its title and its notes as bullets (Tab to nest).
 * Everything is written straight into the note's Meetings section, so intake reads it.
 */
export function MeetingFocus({ meeting, when, prev, next, onChange, onDelete, onPrev, onNext }: Props) {
  // Local drafts, so tidying the saved lines never fights your typing.
  const [title, setTitle] = useState(meeting.title);
  const [notes, setNotes] = useState(meeting.notes);
  const typing = useRef<'title' | 'notes' | null>(null);
  useEffect(() => {
    if (typing.current !== 'title') setTitle(meeting.title);
    if (typing.current !== 'notes') setNotes(meeting.notes);
  }, [meeting.title, meeting.notes]);

  const setNotesAndSave = (value: string) => {
    setNotes(value);
    onChange({ notes: value });
  };

  const onNotesKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: at, value } = ta;
    const lineStart = value.lastIndexOf('\n', at - 1) + 1;
    const edit = (text: string, caret: number) => {
      setNotesAndSave(text);
      // After React has put the new value in.
      window.setTimeout(() => ta.setSelectionRange(caret, caret), 0);
    };
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (value.startsWith(INDENT, lineStart)) edit(value.slice(0, lineStart) + value.slice(lineStart + INDENT.length), Math.max(at - INDENT.length, lineStart));
      } else edit(value.slice(0, lineStart) + INDENT + value.slice(lineStart), at + INDENT.length);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Keep the bullet going at the same depth; Enter on an empty bullet ends the list.
      const line = value.slice(lineStart, at);
      const lead = /^(\s*[-*+] )/.exec(line)?.[1];
      if (!lead) return;
      e.preventDefault();
      if (line === lead) edit(value.slice(0, lineStart) + value.slice(at), lineStart);
      else edit(`${value.slice(0, at)}\n${lead}${value.slice(at)}`, at + 1 + lead.length);
    }
  };

  return (
    <section className="meeting-focus" aria-label="Meeting">
      <p className="mf-when">{when}</p>
      <input
        className="mf-title"
        aria-label="Meeting title"
        value={title}
        onFocus={() => (typing.current = 'title')}
        onBlur={() => (typing.current = null)}
        onChange={(e) => {
          setTitle(e.target.value);
          if (e.target.value.trim()) onChange({ title: e.target.value });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="mf-time">
        {time12(meeting.start)}–{time12(meeting.end)} · {meeting.end - meeting.start} min
        <button className="link-button danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      <textarea
        className="mf-notes"
        aria-label="Meeting notes"
        value={notes}
        placeholder={'- notes go here as bullets\n    - Tab to nest'}
        onFocus={(e) => {
          typing.current = 'notes';
          if (!e.currentTarget.value) setNotes('- ');
        }}
        onBlur={() => {
          typing.current = null;
          if (notes.trim() === '-') setNotes('');
        }}
        onChange={(e) => setNotesAndSave(e.target.value)}
        onKeyDown={onNotesKey}
      />
      <div className="mf-nav">
        <button className="button quiet small" disabled={!prev} onClick={onPrev}>
          ← {prev ?? 'Previous'}
        </button>
        <button className="button quiet small" disabled={!next} onClick={onNext}>
          {next ?? 'Next'} →
        </button>
      </div>
      <p className="muted small">Saved in the note’s Meetings section, so /mindscape reads it.</p>
    </section>
  );
}
