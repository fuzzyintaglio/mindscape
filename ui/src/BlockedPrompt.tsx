import { useState } from 'react';
import { STATUS_LABELS, type StoredCard, compareCards } from '../../core/cards.ts';

type Mode = 'text' | 'card';

/**
 * Shown right after a card moves to Blocked: what is it waiting on? Either something
 * described in words (with an optional expected date) or another card on the board.
 * Everything is optional; Skip or Esc leaves it empty.
 */
export function BlockedPrompt({
  card,
  cards,
  onSave,
  onSkip,
}: {
  card: StoredCard;
  /** The board, to pick a blocking card from. */
  cards: StoredCard[];
  onSave: (blockedBy: string | null, unblockBy: string | null, blockedByCard: string | null) => void;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<Mode>('text');
  const [blockedBy, setBlockedBy] = useState('');
  const [unblockBy, setUnblockBy] = useState('');
  const [blocker, setBlocker] = useState('');
  const choices = cards.filter((c) => c.id !== card.id && c.status !== 'complete').sort(compareCards);

  const save = () => {
    if (mode === 'card') return blocker ? onSave(null, null, blocker) : onSkip();
    if (!blockedBy.trim() && !unblockBy) return onSkip();
    onSave(blockedBy.trim() || null, unblockBy || null, null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onSkip}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="blocked-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onSkip();
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') save();
        }}
      >
        <h2 id="blocked-title">What is blocking this?</h2>
        <p className="muted modal-sub">{card.title}</p>
        <div className="segmented blocked-mode" role="group" aria-label="Blocked by">
          <button className={mode === 'text' ? 'on' : ''} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>
            Waiting on something
          </button>
          <button className={mode === 'card' ? 'on' : ''} aria-pressed={mode === 'card'} onClick={() => setMode('card')}>
            Another card
          </button>
        </div>
        {mode === 'text' ? (
          <>
            <label className="field">
              <span className="field-label">Waiting on</span>
              <input autoFocus value={blockedBy} placeholder="e.g. a review, an answer, another team" onChange={(e) => setBlockedBy(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Expected to unblock</span>
              <input type="date" value={unblockBy} onChange={(e) => setUnblockBy(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">Can’t start until this card is finished</span>
            <select autoFocus aria-label="Blocking card" value={blocker} onChange={(e) => setBlocker(e.target.value)}>
              <option value="">Choose a card…</option>
              {(['in-progress', 'not-started', 'blocked'] as const).map((status) => {
                const group = choices.filter((c) => c.status === status);
                return group.length ? (
                  <optgroup key={status} label={STATUS_LABELS[status]}>
                    {group.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
        )}
        <p className="hint">Optional · Enter to save · Esc to skip</p>
        <div className="row-actions end">
          <button className="button quiet" onClick={onSkip}>
            Skip
          </button>
          <button className="button primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Are you sure this is unblocked?" before any move out of Blocked. */
export function UnblockConfirm({ card, to, blocker, onCancel, onConfirm }: { card: StoredCard; to: string; blocker: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unblock-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2 id="unblock-title">Are you sure this is unblocked?</h2>
        <p className="modal-sub">
          Moving <strong>{card.title}</strong> to {to} clears what it was waiting on
          {blocker ? (
            <>
              {' '}
              (<em>{blocker}</em>)
            </>
          ) : null}
          .
        </p>
        <div className="row-actions end">
          <button className="button quiet" onClick={onCancel}>
            Keep it blocked
          </button>
          <button className="button primary" autoFocus onClick={onConfirm}>
            Yes, it’s unblocked
          </button>
        </div>
      </div>
    </div>
  );
}
