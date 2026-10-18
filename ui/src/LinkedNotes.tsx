import { useEffect, useMemo, useState } from 'react';
import { refName, sameName } from '../../core/links.ts';
import { ApiError, type Note, type NoteSummary, api } from './api.ts';
import { onVaultChange } from './live.ts';
import { Markdown } from './Markdown.tsx';
import { hrefFor } from './route.ts';
import { useToast } from './Toasts.tsx';

/** The reference notes a card links to, shown inline, plus "+ Link note". */
export function LinkedNotes({ refs, onChange }: { refs: string[]; onChange: (names: string[]) => Promise<void> }) {
  const names = refs.map(refName);
  const [picking, setPicking] = useState(false);

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Linked notes</h3>
        {!picking && (
          <button className="button quiet" onClick={() => setPicking(true)}>
            + Link note
          </button>
        )}
      </div>
      {names.length === 0 && !picking && <p className="muted small">No reference notes linked yet.</p>}
      {names.map((name) => (
        <LinkedNote key={name.toLowerCase()} name={name} onUnlink={() => void onChange(names.filter((n) => n !== name))} />
      ))}
      {picking && (
        <NotePicker
          exclude={names}
          onPick={async (name) => {
            await onChange([...names, name]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}

function LinkedNote({ name, onUnlink }: { name: string; onUnlink: () => void }) {
  const [note, setNote] = useState<Note | null | undefined>(undefined); // undefined = loading, null = missing

  useEffect(() => {
    const load = () =>
      api
        .note(name)
        .then((r) => setNote(r.note))
        .catch((err) => setNote(err instanceof ApiError && err.status === 404 ? null : undefined));
    void load();
    return onVaultChange(() => void load());
  }, [name]);

  return (
    <details className="linked-note" open>
      <summary>
        <a href={hrefFor.note(note?.name ?? name)} onClick={(e) => e.stopPropagation()}>
          {note?.name ?? name}
        </a>
        <button
          className="icon-button small"
          aria-label={`Unlink ${name}`}
          title="Unlink"
          onClick={(e) => {
            e.preventDefault();
            onUnlink();
          }}
        >
          ×
        </button>
      </summary>
      <div className="linked-note-body">
        {note === undefined && <p className="muted small">Loading…</p>}
        {note === null && <p className="muted small">This note doesn’t exist (yet). Open the link to create it.</p>}
        {note && (note.text.trim() ? <Markdown text={note.text} /> : <p className="muted small">Empty note.</p>)}
      </div>
    </details>
  );
}

/** Type to find a reference note; Enter links the highlighted one, or creates a new note with that name. */
export function NotePicker({ exclude, onPick, onClose }: { exclude: string[]; onPick: (name: string) => Promise<void>; onClose: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    api
      .notes()
      .then((r) => setAll(r.notes))
      .catch(() => {});
  }, []);

  const q = query.trim();
  const matches = useMemo(
    () => all.filter((n) => !exclude.some((e) => sameName(e, n.name)) && n.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8),
    [all, exclude, q],
  );
  const exact = all.some((n) => sameName(n.name, q));
  const options = [...matches.map((n) => ({ name: n.name, create: false })), ...(q && !exact ? [{ name: q, create: true }] : [])];

  const pick = async (option: { name: string; create: boolean } | undefined) => {
    if (!option) return;
    try {
      const name = option.create ? (await api.createNote(option.name)).note.name : option.name;
      await onPick(name);
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="note-picker">
      <input
        autoFocus
        value={query}
        placeholder="Find or create a note…"
        aria-label="Find a note to link"
        role="combobox"
        aria-expanded={options.length > 0}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter') void pick(options[active]);
          else if (e.key === 'Escape') onClose();
          else return;
          e.preventDefault();
        }}
        onBlur={() => {
          if (!query) onClose();
        }}
      />
      {options.length > 0 && (
        <ul className="picker-options" role="listbox">
          {options.map((o, i) => (
            <li
              key={`${o.create}-${o.name}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                void pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.create ? (
                <>
                  Create note “<strong>{o.name}</strong>”
                </>
              ) : (
                o.name
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Enter to link · Esc to close</p>
    </div>
  );
}
