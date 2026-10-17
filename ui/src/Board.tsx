import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMemo, useRef, useState } from 'react';
import {
  type Effort,
  STATUSES,
  STATUS_LABELS,
  type Status,
  type StoredCard,
  compareCards,
  isUnblockDue,
} from '../../core/cards.ts';

const EMPTY: Record<Status, string> = {
  'not-started': 'Nothing queued up. Add something below.',
  'in-progress': 'Nothing in flight right now.',
  blocked: 'Nothing blocked. Nice.',
  complete: 'Finished cards land here for a week.',
};

const EFFORT_LETTER: Record<Effort, string> = { low: 'L', medium: 'M', high: 'H' };
const EFFORT_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface BoardProps {
  cards: StoredCard[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onMove: (card: StoredCard, to: Status) => void;
  onCycleEffort: (card: StoredCard) => void;
  onDelete: (card: StoredCard) => void;
  onCreate: (title: string, status: Status) => Promise<void>;
}

export function Board({ cards, selectedId, onOpen, onMove, onCycleEffort, onDelete, onCreate }: BoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<StoredCard | null>(null);
  const justDragged = useRef(false);

  const columns = useMemo(() => {
    const by = Object.fromEntries(STATUSES.map((s) => [s, [] as StoredCard[]])) as Record<Status, StoredCard[]>;
    for (const c of cards) by[c.status].push(c);
    for (const s of STATUSES) by[s].sort(compareCards);
    return by;
  }, [cards]);

  const onDragStart = (e: DragStartEvent) => setDragging(cards.find((c) => c.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 50);
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id as Status | undefined;
    if (card && to && to !== card.status) onMove(card, to);
  };

  const open = (id: string) => {
    if (!justDragged.current) onOpen(id);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="board">
        {STATUSES.map((status) => (
          <Column key={status} status={status} count={columns[status].length} onCreate={onCreate}>
            {columns[status].length === 0 ? (
              <p className="column-empty">{EMPTY[status]}</p>
            ) : (
              columns[status].map((card) => (
                <DraggableCard
                  key={card.id}
                  card={card}
                  selected={card.id === selectedId}
                  onOpen={open}
                  onCycleEffort={onCycleEffort}
                  onDelete={onDelete}
                />
              ))
            )}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {dragging && <CardTile card={dragging} overlay />}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  count,
  onCreate,
  children,
}: {
  status: Status;
  count: number;
  onCreate: (title: string, status: Status) => Promise<void>;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={`column column-${status} ${isOver ? 'drop-target' : ''}`} aria-label={STATUS_LABELS[status]}>
      <header className="column-header">
        <h2>{STATUS_LABELS[status]}</h2>
        <span className="column-count">{count}</span>
      </header>
      <div className="column-cards">{children}</div>
      <AddCard status={status} onCreate={onCreate} />
    </section>
  );
}

function AddCard({ status, onCreate }: { status: Status; onCreate: (title: string, status: Status) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="add-card" onClick={() => setOpen(true)}>
        + Add card
      </button>
    );
  }

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(title.trim(), status);
      setTitle(''); // stay open so the next card is one Enter away
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-card-form">
      <input
        autoFocus
        value={title}
        placeholder="Card title"
        aria-label="New card title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') {
            setTitle('');
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
      <p className="hint">Enter to add · Esc to close</p>
    </div>
  );
}

function DraggableCard(props: {
  card: StoredCard;
  selected: boolean;
  onOpen: (id: string) => void;
  onCycleEffort: (card: StoredCard) => void;
  onDelete: (card: StoredCard) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.card.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={props.card.title}
      className={`card-slot ${isDragging ? 'drag-source' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) props.onOpen(props.card.id);
      }}
    >
      <CardTile {...props} />
    </div>
  );
}

function CardTile({
  card,
  selected,
  overlay,
  onOpen,
  onCycleEffort,
  onDelete,
}: {
  card: StoredCard;
  selected?: boolean;
  overlay?: boolean;
  onOpen?: (id: string) => void;
  onCycleEffort?: (card: StoredCard) => void;
  onDelete?: (card: StoredCard) => void;
}) {
  const due = isUnblockDue(card);
  return (
    <article
      className={`card ${selected ? 'selected' : ''} ${overlay ? 'overlay' : ''}`}
      onClick={() => onOpen?.(card.id)}
    >
      <div className="card-row">
        <button
          className={`effort effort-${card.effort}`}
          title={`Effort: ${EFFORT_NAME[card.effort]} (click to change)`}
          aria-label={`Effort ${EFFORT_NAME[card.effort]}. Click to change.`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCycleEffort?.(card);
          }}
        >
          {EFFORT_LETTER[card.effort]}
        </button>
        <span className="card-title">{card.title}</span>
        {onDelete && (
          <button
            className="card-delete"
            title="Delete card"
            aria-label={`Delete ${card.title}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(card);
            }}
          >
            ×
          </button>
        )}
      </div>
      {card.status === 'blocked' && (card.blockedBy || card.unblockBy) && (
        <p className={`card-blocker ${due ? 'due' : ''}`}>
          {card.blockedBy && <span>Waiting on {card.blockedBy}</span>}
          {card.unblockBy && (
            <span className="unblock-date">
              {due ? 'Follow up — expected ' : 'Expected '}
              {formatDate(card.unblockBy)}
            </span>
          )}
        </p>
      )}
    </article>
  );
}
