import { Suspense, lazy, useEffect, useState } from 'react';
import { EFFORTS, type Effort, STATUSES, STATUS_LABELS, type Status, type StoredCard } from '../../core/cards.ts';
import { ApiError, type CardPatch, api } from './api.ts';
import { formatDate } from './Board.tsx';
import { Markdown } from './Markdown.tsx';
import { useToast } from './Toasts.tsx';

// The editor (CodeMirror) is the biggest part of the UI, so it loads on first use.
const NotesEditor = lazy(() => import('./NotesEditor.tsx'));

const EFFORT_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High' };

interface Props {
  card: StoredCard;
  onClose: () => void;
  onMove: (card: StoredCard, to: Status) => void;
  onDelete: (card: StoredCard) => void;
  /** Called with the saved card after any change made from the panel. */
  onUpdated: (card: StoredCard) => void;
  /** Tells the app whether there are unsaved notes, so it can ask before switching cards. */
  onDirtyChange: (dirty: boolean) => void;
}

export function CardPanel({ card, onClose, onMove, onDelete, onUpdated, onDirtyChange }: Props) {
  const toast = useToast();
  const [title, setTitle] = useState(card.title);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.notes);
  const [baseNotes, setBaseNotes] = useState(card.notes);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = editing && draft !== baseNotes;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Keep the title field in sync when the card changes elsewhere (unless it's being typed in).
  useEffect(() => {
    if (document.activeElement?.id !== 'card-title') setTitle(card.title);
  }, [card.title]);

  // Warn before leaving the page with unsaved notes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = async (p: CardPatch) => {
    try {
      const result = await api.updateCard(card.id, p);
      onUpdated(result.card);
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) throw err;
      toast({ message: (err as Error).message, tone: 'error' });
      return null;
    }
  };

  const commitTitle = async () => {
    const next = title.trim();
    if (!next) return setTitle(card.title);
    if (next !== card.title) await patch({ title: next });
  };

  const startEditing = () => {
    setDraft(card.notes);
    setBaseNotes(card.notes);
    setConflict(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (draft !== baseNotes && !window.confirm('Discard your unsaved changes to these notes?')) return;
    setEditing(false);
    setConflict(false);
  };

  const save = async (force = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await patch(force ? { notes: draft } : { notes: draft, baseNotes });
      if (result) {
        setEditing(false);
        setConflict(false);
      }
    } catch {
      setConflict(true); // 409: the file changed since editing started
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

  // Esc closes the panel when nothing is being edited.
  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Escape' && !typing && !document.querySelector('.modal')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  return (
    <aside className="panel-card" aria-label="Card details">
      <div className="panel-top">
        <span className="panel-path" title={card.path}>
          {STATUS_LABELS[card.status]}
        </span>
        <button className="icon-button" onClick={onClose} aria-label="Close card" title="Close (Esc)">
          ×
        </button>
      </div>

      <input
        id="card-title"
        className="panel-title"
        value={title}
        aria-label="Card title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void commitTitle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setTitle(card.title);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />

      <div className="field">
        <span className="field-label">Status</span>
        <div className="segmented" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s} className={s === card.status ? 'on' : ''} aria-pressed={s === card.status} onClick={() => onMove(card, s)}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Effort</span>
        <div className="segmented" role="group" aria-label="Effort">
          {EFFORTS.map((e) => (
            <button key={e} className={e === card.effort ? 'on' : ''} aria-pressed={e === card.effort} onClick={() => void patch({ effort: e })}>
              {EFFORT_NAME[e]}
            </button>
          ))}
        </div>
      </div>

      {card.status === 'blocked' && <BlockerFields card={card} onSave={(p) => void patch(p)} />}

      <section className="panel-section">
        <div className="section-head">
          <h3>Notes</h3>
          {editing ? (
            <div className="row-actions">
              <button className="button quiet" onClick={cancelEditing}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : null}
        </div>

        {conflict && (
          <div className="conflict">
            <p>This card changed somewhere else while you were editing.</p>
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
              <NotesEditor initial={baseNotes} onChange={setDraft} onSave={() => void save()} onCancel={cancelEditing} />
            </Suspense>
            <p className="hint">⌘S to save · Esc to cancel</p>
          </>
        ) : (
          <div className="notes-view" role="button" tabIndex={0} onClick={startEditing} onKeyDown={(e) => e.key === 'Enter' && startEditing()}>
            {card.notes ? <Markdown text={card.notes} /> : <p className="placeholder">Click to add notes…</p>}
          </div>
        )}
      </section>

      {card.log && (
        <section className="panel-section">
          <h3>Log</h3>
          <Markdown text={card.log} className="log" />
        </section>
      )}

      <footer className="panel-footer">
        <span className="muted small">Created {new Date(card.created).toLocaleDateString()}</span>
        <button className="button danger-quiet" onClick={() => onDelete(card)}>
          Delete card
        </button>
      </footer>
    </aside>
  );
}

function BlockerFields({ card, onSave }: { card: StoredCard; onSave: (p: CardPatch) => void }) {
  const [blockedBy, setBlockedBy] = useState(card.blockedBy ?? '');
  const [unblockBy, setUnblockBy] = useState(card.unblockBy ?? '');

  useEffect(() => {
    setBlockedBy(card.blockedBy ?? '');
    setUnblockBy(card.unblockBy ?? '');
  }, [card.blockedBy, card.unblockBy]);

  return (
    <div className="blocker-fields">
      <label className="field">
        <span className="field-label">Waiting on</span>
        <input
          value={blockedBy}
          placeholder="What is blocking this?"
          onChange={(e) => setBlockedBy(e.target.value)}
          onBlur={() => blockedBy.trim() !== (card.blockedBy ?? '') && onSave({ blockedBy: blockedBy.trim() || null })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <label className="field">
        <span className="field-label">Expected to unblock</span>
        <input
          type="date"
          value={unblockBy}
          onChange={(e) => {
            setUnblockBy(e.target.value);
            onSave({ unblockBy: e.target.value || null });
          }}
        />
        {card.unblockBy && <span className="muted small">{formatDate(card.unblockBy)}</span>}
      </label>
    </div>
  );
}
