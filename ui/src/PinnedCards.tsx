import { useState } from 'react';
import { type Effort, STATUS_LABELS, type Status, type StoredCard, compareCards } from '../../core/cards.ts';
import type { VaultConfig } from '../../core/configDefaults.ts';
import { MAX_PINS } from '../../core/pins.ts';
import { formatPoints } from '../../core/points.ts';

const EFFORT_LETTER: Record<Effort, string> = { low: 'L', medium: 'M', high: 'H' };
const PICK_GROUPS: Status[] = ['in-progress', 'not-started', 'blocked'];

/** What the pinned cards need from the app: today's pins and how to change them. */
export interface PinProps {
  pinned: string[];
  config: VaultConfig;
  onMove: (card: StoredCard, to: Status) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
}

interface Props extends PinProps {
  cards: StoredCard[];
  onOpen: (id: string) => void;
}

/**
 * Today's priorities: up to five cards picked from the board each morning. Starting a
 * pinned card earns a bonus; pins clear at midnight, so picking them is a daily choice.
 */
export function PinnedCards({ cards, pinned, config, onOpen, onMove, onPin, onUnpin }: Props) {
  const [picking, setPicking] = useState(false);
  const pins = pinned.map((id) => cards.find((c) => c.id === id)).filter((c): c is StoredCard => !!c);
  const full = pins.length >= MAX_PINS;

  return (
    <section className="pinned" aria-label="Today's priorities">
      <ul className="pinned-list">
        {pins.map((c) => (
          <li key={c.id} className={`pin-card status-${c.status}`}>
            <button className="pin-unpin" aria-label={`Unpin ${c.title}`} title="Unpin" onClick={() => onUnpin(c.id)}>
              ×
            </button>
            <button className="pin-title" onClick={() => onOpen(c.id)}>
              {c.title}
            </button>
            <div className="pin-meta">
              <span className={`effort-tag effort-${c.effort}`}>{EFFORT_LETTER[c.effort]}</span>
              <span className={`pin-status status-${c.status}`}>{STATUS_LABELS[c.status]}</span>
              {c.status === 'not-started' && (
                <button className="pin-go" onClick={() => onMove(c, 'in-progress')}>
                  Start · +{formatPoints(config.pinPoints[c.effort])}
                </button>
              )}
              {c.status === 'in-progress' && (
                <button className="pin-go done" onClick={() => onMove(c, 'complete')}>
                  Complete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {picking && <PinPicker cards={cards} pinned={pinned} onPick={(id) => (onPin(id), setPicking(false))} />}
      {full ? (
        <p className="pin-slot full">Five pinned. That’s the limit for today.</p>
      ) : (
        <button className="pin-slot" onClick={() => setPicking((p) => !p)}>
          {picking ? 'Cancel' : pins.length ? '+ Pin another card' : '+ Pin a card for today'}
        </button>
      )}
    </section>
  );
}

/** Every card that isn't Complete or already pinned, grouped by status, High effort first. */
function PinPicker({ cards, pinned, onPick }: { cards: StoredCard[]; pinned: string[]; onPick: (id: string) => void }) {
  const groups = PICK_GROUPS.map((status) => ({
    status,
    cards: cards.filter((c) => c.status === status && !pinned.includes(c.id)).sort(compareCards),
  })).filter((g) => g.cards.length);
  return (
    <div className="pin-picker" role="listbox" aria-label="Pick a card to pin">
      {groups.length === 0 && <p className="muted small">Nothing left to pin.</p>}
      {groups.map((g) => (
        <div key={g.status} role="group" aria-label={STATUS_LABELS[g.status]}>
          <p className="pin-group">{STATUS_LABELS[g.status]}</p>
          {g.cards.map((c) => (
            <button key={c.id} role="option" aria-selected={false} className="pin-option" onClick={() => onPick(c.id)}>
              <span className={`effort-tag effort-${c.effort}`}>{EFFORT_LETTER[c.effort]}</span>
              {c.title}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
