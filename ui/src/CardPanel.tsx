import { useCallback, useEffect, useRef, useState } from 'react';
import { EFFORTS, type Effort, STATUSES, STATUS_LABELS, type Status, type StoredCard } from '../../core/cards.ts';
import { ApiError, type CardPatch, api } from './api.ts';
import { formatDate } from './Board.tsx';
import { EditableMarkdown, type SaveOutcome } from './EditableMarkdown.tsx';
import { LinkedNotes } from './LinkedNotes.tsx';
import { Markdown } from './Markdown.tsx';
import { useToast } from './Toasts.tsx';

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
  const [notesDirty, setNotesDirty] = useState(false);

  // Keep the title field in sync when the card changes elsewhere (unless it's being typed in).
  useEffect(() => {
    if (document.activeElement?.id !== 'card-title') setTitle(card.title);
  }, [card.title]);

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

  const saveNotes = async (draft: string, base: string | undefined): Promise<SaveOutcome> => {
    try {
      return (await patch(base === undefined ? { notes: draft } : { notes: draft, baseNotes: base })) ? 'saved' : 'failed';
    } catch {
      return 'conflict'; // 409: the notes changed since editing started
    }
  };

  const onNotesDirty = useCallback(
    (d: boolean) => {
      setNotesDirty(d);
      onDirtyChange(d);
    },
    [onDirtyChange],
  );

  // Focus moves into the panel when it opens, so Tab and the keyboard work inside it.
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  // Esc closes the panel when nothing is being edited (the editor handles its own Esc).
  useEffect(() => {
    if (notesDirty) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable;
      if (e.key === 'Escape' && !typing && !e.defaultPrevented && !document.querySelector('.modal')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notesDirty, onClose]);

  return (
    <aside className="panel-card" aria-label="Card details" tabIndex={-1} ref={panel}>
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

      <LinkedNotes refs={card.refs} onChange={async (refs) => void (await patch({ refs }))} />

      <EditableMarkdown text={card.notes} onSave={saveNotes} onDirtyChange={onNotesDirty} />

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
