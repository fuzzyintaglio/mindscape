import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

const SAVE_MS = 500;

/** A day's throwaway notes: a number to remember, an address. Not part of the daily note. */
export function Stickies({ date }: { date: string }) {
  const [items, setItems] = useState<string[] | null>(null);
  const timer = useRef<number>();
  const pending = useRef<string[] | null>(null);
  const focusLast = useRef(false);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    api.stickies(date).then(
      (r) => live && setItems(r.items),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [date]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) void api.saveStickies(date, next).catch(() => {});
  };

  // Save what's left when leaving the day.
  useEffect(() => flush, [date]);

  const change = (next: string[], now = false) => {
    setItems(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    if (now) flush();
    else timer.current = window.setTimeout(flush, SAVE_MS);
  };

  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    const all = list.current?.querySelectorAll('textarea');
    all?.[all.length - 1]?.focus();
  }, [items]);

  if (items === null) return null;
  return (
    <div className="stickies" ref={list}>
      {items.map((text, i) => (
        <div key={i} className="sticky">
          <button className="sticky-x" aria-label="Delete sticky" title="Delete" onClick={() => change(items.filter((_, j) => j !== i), true)}>
            ×
          </button>
          <textarea
            aria-label="Sticky"
            value={text}
            onChange={(e) => change(items.map((s, j) => (j === i ? e.target.value : s)))}
            onBlur={() => {
              if (!text.trim()) change(items.filter((_, j) => j !== i), true);
              else flush();
            }}
          />
        </div>
      ))}
      <button
        className="sticky add"
        onClick={() => {
          focusLast.current = true;
          setItems([...items, '']);
        }}
      >
        + Sticky
      </button>
    </div>
  );
}
