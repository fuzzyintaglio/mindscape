import { Suspense, lazy, useEffect, useState } from 'react';
import { Markdown } from './Markdown.tsx';

// The editor (CodeMirror) is the biggest part of the UI, so it loads on first use.
const NotesEditor = lazy(() => import('./NotesEditor.tsx'));

export type SaveOutcome = 'saved' | 'conflict' | 'failed';

interface Props {
  text: string;
  /** Save `draft`; `base` is the text editing started from, for spotting edits made elsewhere. */
  onSave: (draft: string, base: string | undefined) => Promise<SaveOutcome>;
  /** Tells the parent whether there are unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
  placeholder?: string;
  label?: string;
}

/**
 * Rendered markdown that turns into an editor when clicked; Save (or ⌘S) writes it.
 * If the text changed elsewhere meanwhile, asks instead of overwriting.
 */
export function EditableMarkdown({ text, onSave, onDirtyChange, placeholder = 'Click to add notes…', label = 'Notes' }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [base, setBase] = useState(text);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = editing && draft !== base;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Warn before leaving the page with unsaved notes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const startEditing = () => {
    setDraft(text);
    setBase(text);
    setConflict(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (draft !== base && !window.confirm('Discard your unsaved changes to these notes?')) return;
    setEditing(false);
    setConflict(false);
  };

  const save = async (force = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const outcome = await onSave(draft, force ? undefined : base);
      if (outcome === 'saved') {
        setEditing(false);
        setConflict(false);
      } else if (outcome === 'conflict') setConflict(true);
    } finally {
      setSaving(false);
    }
  };

  // ⌘S saves even when focus has left the editor.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section className="panel-section editable" data-editing={editing || undefined}>
      <div className="section-head">
        <h3>{label}</h3>
        {editing && (
          <div className="row-actions">
            <button className="button quiet" onClick={cancelEditing}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {conflict && (
        <div className="conflict">
          <p>This changed somewhere else while you were editing.</p>
          <div className="row-actions">
            <button
              className="button quiet"
              onClick={() => {
                setEditing(false);
                setConflict(false);
              }}
            >
              Reload theirs
            </button>
            <button className="button primary" onClick={() => void save(true)}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <>
          <Suspense fallback={<p className="muted">Opening editor…</p>}>
            <NotesEditor initial={base} onChange={setDraft} onSave={() => void save()} onCancel={cancelEditing} />
          </Suspense>
          <p className="hint">⌘S to save · Esc to cancel</p>
        </>
      ) : (
        <div
          className="notes-view"
          role="button"
          tabIndex={0}
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={(e) => {
            // Following a link inside the notes shouldn't start editing.
            if (!(e.target as HTMLElement).closest('a')) startEditing();
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && startEditing()}
        >
          {text ? <Markdown text={text} /> : <p className="placeholder">{placeholder}</p>}
        </div>
      )}
    </section>
  );
}
