import { useState } from 'react';
import type { StoredCard } from '../../core/cards.ts';

/** Shown right after a card moves to Blocked. Both fields are optional; Skip or Esc leaves them empty. */
export function BlockedPrompt({
  card,
  onSave,
  onSkip,
}: {
  card: StoredCard;
  onSave: (blockedBy: string | null, unblockBy: string | null) => void;
  onSkip: () => void;
}) {
  const [blockedBy, setBlockedBy] = useState('');
  const [unblockBy, setUnblockBy] = useState('');

  const save = () => {
    if (!blockedBy.trim() && !unblockBy) return onSkip();
    onSave(blockedBy.trim() || null, unblockBy || null);
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
          if (e.key === 'Enter') save();
        }}
      >
        <h2 id="blocked-title">What is blocking this?</h2>
        <p className="muted modal-sub">{card.title}</p>
        <label className="field">
          <span className="field-label">Waiting on</span>
          <input autoFocus value={blockedBy} placeholder="e.g. a review, an answer, another team" onChange={(e) => setBlockedBy(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Expected to unblock</span>
          <input type="date" value={unblockBy} onChange={(e) => setUnblockBy(e.target.value)} />
        </label>
        <p className="hint">Both optional · Enter to save · Esc to skip</p>
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
