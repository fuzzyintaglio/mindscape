import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABELS } from '../../core/cards.ts';
import { ApiError, type Note, type NoteSummary, api } from './api.ts';
import { EditableMarkdown, type SaveOutcome } from './EditableMarkdown.tsx';
import { Markdown } from './Markdown.tsx';
import { onVaultChange } from './live.ts';
import { hrefFor, navigate } from './route.ts';
import { useToast } from './Toasts.tsx';

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** All reference notes, most recently changed first. Stale ones are flagged, with a way to archive them. */
export function NotesPage({ onUndo }: { onUndo: (undoId: string) => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [archived, setArchived] = useState<NoteSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const load = () =>
      api
        .notes()
        .then((r) => {
          setNotes(r.notes);
          setArchived(r.archived);
        })
        .catch(() => {});
    void load();
    return onVaultChange(() => void load());
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const { note } = await api.createNote(name);
      navigate(hrefFor.note(note.name));
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const archive = async (name?: string) => {
    const stale = (notes ?? []).filter((n) => n.stale);
    if (!name && !window.confirm(`Archive ${stale.length} stale note${stale.length === 1 ? '' : 's'}? They leave this list but stay searchable, and links to them keep working.`)) return;
    try {
      const { undoId, archived: done } = name ? await api.archiveNote(name) : await api.archiveStaleNotes();
      const r = await api.notes();
      setNotes(r.notes);
      setArchived(r.archived);
      toast({
        message: done.length === 1 ? `Archived “${done[0]}”` : `Archived ${done.length} notes`,
        action: undoId ? { label: 'Undo', run: () => onUndo(undoId) } : undefined,
      });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const restore = async (name: string) => {
    try {
      const { undoId } = await api.restoreNote(name);
      const r = await api.notes();
      setNotes(r.notes);
      setArchived(r.archived);
      toast({ message: `Restored “${name}”`, action: { label: 'Undo', run: () => onUndo(undoId) } });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const q = filter.trim().toLowerCase();
  const matches = (n: NoteSummary) => !q || n.name.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q);
  const shown = (notes ?? []).filter(matches);
  const staleCount = (notes ?? []).filter((n) => n.stale).length;

  return (
    <div className="notes-page">
      <header className="page-header">
        <h2>{showArchived ? 'Archived notes' : 'Reference notes'}</h2>
        <div className="row-actions">
          {!showArchived && staleCount > 0 && (
            <button className="button quiet stale-all" onClick={() => void archive()}>
              Archive all stale ({staleCount})
            </button>
          )}
          {(archived.length > 0 || showArchived) && (
            <button className="button quiet" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? '← Back to notes' : `Archived (${archived.length})`}
            </button>
          )}
          <input className="filter" value={filter} placeholder="Filter…" aria-label="Filter notes" onChange={(e) => setFilter(e.target.value)} />
          {!creating && (
            <button className="button primary" onClick={() => setCreating(true)}>
              + New note
            </button>
          )}
        </div>
      </header>

      {creating && (
        <div className="new-note">
          <input
            autoFocus
            value={name}
            placeholder="Note name, e.g. a project or a person"
            aria-label="New note name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
              if (e.key === 'Escape') {
                setName('');
                setCreating(false);
              }
            }}
            onBlur={() => !name.trim() && setCreating(false)}
          />
          <p className="hint">Enter to create · Esc to close</p>
        </div>
      )}

      {showArchived ? (
        archived.filter(matches).length === 0 ? (
          <p className="muted empty">No archived notes{q ? ` match “${filter}”` : ''}.</p>
        ) : (
          <ul className="note-list">
            {archived.filter(matches).map((n) => (
              <li key={n.path} className="archived">
                <a href={hrefFor.note(n.name)}>
                  <span className="note-name">{n.name}</span>
                  <span className="note-preview muted">{n.preview}</span>
                  <span className="note-meta muted small">Archived {timeAgo(n.modified)}</span>
                </a>
                <button className="button quiet small note-action" onClick={() => void restore(n.name)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )
      ) : notes === null ? (
        <p className="muted">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="muted empty">
          No reference notes yet. They hold what a topic needs over time — people, timelines, decisions — and can be linked from any card.
        </p>
      ) : shown.length === 0 ? (
        <p className="muted empty">No notes match “{filter}”.</p>
      ) : (
        <ul className="note-list">
          {shown.map((n) => (
            <li key={n.path} className={n.stale ? 'stale' : ''}>
              <a href={hrefFor.note(n.name)}>
                <span className="note-name">{n.name}</span>
                <span className="note-preview muted">{n.preview}</span>
                <span className="note-meta muted small">
                  {n.stale && <span className="stale-tag">Stale · </span>}
                  {n.linkedCards > 0 && `${n.linkedCards} card${n.linkedCards > 1 ? 's' : ''} · `}
                  {timeAgo(n.modified)}
                </span>
              </a>
              {n.stale && (
                <button className="button quiet small note-action" onClick={() => void archive(n.name)} title="Untouched for 30+ days and not linked to an active card">
                  Archive
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface NoteProps {
  name: string;
  onOpenCard: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onUndo: (undoId: string) => void;
}

/** One reference note: rename it, edit it, see which cards link to it. */
export function NotePage({ name, onOpenCard, onDirtyChange, onUndo }: NoteProps) {
  const toast = useToast();
  const [note, setNote] = useState<Note | null | undefined>(undefined); // undefined = loading, null = missing
  const [title, setTitle] = useState(name);

  const load = useCallback(async () => {
    try {
      const { note } = await api.note(name);
      setNote(note);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNote(null);
    }
  }, [name]);

  useEffect(() => {
    setNote(undefined);
    setTitle(name);
    void load();
    return onVaultChange(() => void load());
  }, [load, name]);

  useEffect(() => {
    if (note && document.activeElement?.id !== 'note-title') setTitle(note.name);
  }, [note]);

  if (note === undefined) return <p className="muted page-pad">Loading…</p>;
  if (note === null) {
    return (
      <div className="note-page">
        <a className="back" href={hrefFor.notes()}>
          ← All notes
        </a>
        <h2>{name}</h2>
        <p className="muted">There’s no note with this name yet.</p>
        <button
          className="button primary"
          onClick={async () => {
            try {
              const { note } = await api.createNote(name);
              setNote(note);
              if (note.name !== name) navigate(hrefFor.note(note.name));
            } catch (err) {
              toast({ message: (err as Error).message, tone: 'error' });
            }
          }}
        >
          Create “{name}”
        </button>
      </div>
    );
  }

  const rename = async () => {
    const next = title.trim();
    if (!next || next === note.name) return setTitle(note.name);
    try {
      const result = await api.renameNote(note.name, next);
      setNote(result.note);
      navigate(hrefFor.note(result.note.name));
      const undoId = result.undoId;
      toast({
        message: result.updated ? `Renamed — updated links in ${result.updated} file${result.updated > 1 ? 's' : ''}` : 'Renamed',
        action: undoId
          ? {
              label: 'Undo',
              run: () => {
                onUndo(undoId);
                navigate(hrefFor.note(note.name));
              },
            }
          : undefined,
      });
    } catch (err) {
      setTitle(note.name);
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const save = async (draft: string, base: string | undefined): Promise<SaveOutcome> => {
    try {
      // Without a base ("Keep mine"), save over whatever is there now.
      const { note: saved } = await api.saveNote(note.name, draft, base ?? (await api.note(note.name)).note.text);
      setNote(saved);
      return 'saved';
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return 'conflict';
      toast({ message: (err as Error).message, tone: 'error' });
      return 'failed';
    }
  };

  const remove = async () => {
    try {
      const { undoId } = await api.deleteNote(note.name);
      navigate(hrefFor.notes());
      toast({ message: `Deleted “${note.name}”`, action: { label: 'Undo', run: () => onUndo(undoId) } });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  if (note.archived) {
    return (
      <div className="note-page">
        <a className="back" href={hrefFor.notes()}>
          ← All notes
        </a>
        <h2>{note.name}</h2>
        <div className="archived-banner">
          <span>This note is archived. It’s still searchable, and links to it still work.</span>
          <button
            className="button primary small"
            onClick={async () => {
              try {
                const { note: restored, undoId } = await api.restoreNote(note.name);
                setNote(restored);
                toast({ message: `Restored “${note.name}”`, action: { label: 'Undo', run: () => onUndo(undoId) } });
              } catch (err) {
                toast({ message: (err as Error).message, tone: 'error' });
              }
            }}
          >
            Restore
          </button>
        </div>
        <Markdown text={note.text} className="markdown" />
      </div>
    );
  }

  return (
    <div className="note-page">
      <a className="back" href={hrefFor.notes()}>
        ← All notes
      </a>
      <input
        id="note-title"
        className="panel-title"
        value={title}
        aria-label="Note name"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setTitle(note.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />

      <section className="linked-cards" aria-label="Linked cards">
        <h3>Linked cards</h3>
        {note.cards.length === 0 ? (
          <p className="muted small">No cards link here yet. Open a card and use “+ Link note”.</p>
        ) : (
          <ul>
            {note.cards.map((c) => (
              <li key={c.id}>
                {c.archived ? (
                  <span>{c.title}</span>
                ) : (
                  <button className="link-button" onClick={() => onOpenCard(c.id)}>
                    {c.title}
                  </button>
                )}
                <span className={`status-pill status-${c.archived ? 'archived' : c.status}`}>{c.archived ? 'Archived' : STATUS_LABELS[c.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EditableMarkdown key={note.name} text={note.text} onSave={save} onDirtyChange={onDirtyChange} placeholder="Click to start writing…" label="Note" />

      <footer className="panel-footer">
        <span className="muted small">{note.path}</span>
        <button className="button danger-quiet" onClick={() => void remove()}>
          Delete note
        </button>
      </footer>
    </div>
  );
}
