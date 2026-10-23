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
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BoardFilter,
  DUE_WINDOWS,
  type DueWindow,
  type Effort,
  NO_FILTER,
  STATUSES,
  STATUS_LABELS,
  type Status,
  type StoredCard,
  blockerDone,
  blockingCounts,
  compareCards,
  dueState,
  isUnblockDue,
  matchesFilter,
} from '../../core/cards.ts';
import { refName } from '../../core/links.ts';
import { toLocalDate } from '../../core/time.ts';
import { IDLE_DAYS, isIdle } from '../../core/today.ts';

const EMPTY: Record<Status, string> = {
  'not-started': 'Nothing queued up. Add something below.',
  'in-progress': 'Nothing in flight right now.',
  blocked: 'Nothing blocked. Nice.',
  complete: 'Finished cards land here for a week.',
};

/** Put keyboard focus on a card on the board. */
export function focusCard(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
  el?.focus();
  return !!el;
}

const EFFORT_LETTER: Record<Effort, string> = { low: 'L', medium: 'M', high: 'H' };
const EFFORT_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Overdue · Oct 22", "Due today", "Due Fri, Oct 30". */
export function dueLabel(card: StoredCard): string | null {
  if (!card.due) return null;
  const state = dueState(card);
  if (state === 'overdue') return `Overdue · ${formatDate(card.due)}`;
  const d = new Date(`${card.due}T00:00:00`);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Due today';
  return `Due ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

const WINDOW_LABEL: Record<DueWindow, string> = { week: 'This week', month: 'This month', quarter: 'This quarter' };

interface BoardProps {
  cards: StoredCard[];
  /** Card ids pinned to today. */
  pinned: string[];
  filter: BoardFilter;
  onFilter: (filter: BoardFilter) => void;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onMove: (card: StoredCard, to: Status) => void;
  onCycleEffort: (card: StoredCard) => void;
  onDelete: (card: StoredCard) => void;
  onCreate: (title: string, status: Status) => Promise<void>;
}

export function Board({ cards: allCards, pinned, filter, onFilter, selectedId, onOpen, onMove, onCycleEffort, onDelete, onCreate }: BoardProps) {
  const filtering = !!(filter.note || filter.due);
  const cards = useMemo(() => {
    if (!filtering) return allCards;
    const today = toLocalDate();
    return allCards.filter((c) => matchesFilter(c, filter, today));
  }, [allCards, filter, filtering]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<StoredCard | null>(null);
  const justDragged = useRef(false);

  // Not Started cards untouched for two weeks fold into a stack at the foot of the column.
  // It starts folded on every load.
  const [idleOpen, setIdleOpen] = useState(false);
  const { columns, idle } = useMemo(() => {
    const by = Object.fromEntries(STATUSES.map((s) => [s, [] as StoredCard[]])) as Record<Status, StoredCard[]>;
    const idle: StoredCard[] = [];
    const now = new Date();
    for (const c of cards) (isIdle(c, now) ? idle : by[c.status]).push(c);
    for (const s of STATUSES) by[s].sort(compareCards);
    idle.sort(compareCards);
    if (idleOpen) by['not-started'].push(...idle);
    return { columns: by, idle };
  }, [cards, idleOpen]);
  const idleIds = useMemo(() => new Set(idle.map((c) => c.id)), [idle]);
  // Cards blocked by another card, and the cards doing the blocking.
  const blocking = useMemo(() => blockingCounts(allCards), [allCards]);
  const blockerOf = (card: StoredCard) => {
    const done = blockerDone(card, allCards);
    if (done === null) return undefined;
    return { title: allCards.find((c) => c.id === card.blockedByCard)?.title ?? 'a card that’s no longer on the board', done };
  };

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

  // After a keyboard move or delete, keep focus on the board (the card's element is new).
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current && focusCard(refocus.current)) refocus.current = null;
  }, [cards]);

  /** Arrows select, 1–4 move, e changes effort, Delete deletes. */
  const onCardKey = (card: StoredCard, e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target !== e.currentTarget) return;
    const col = STATUSES.indexOf(card.status);
    const list = columns[card.status];
    const row = list.findIndex((c) => c.id === card.id);
    const go = (target: StoredCard | undefined) => {
      e.preventDefault();
      if (target) focusCard(target.id);
    };
    if (e.key === 'ArrowDown') return go(list[row + 1]);
    if (e.key === 'ArrowUp') return go(list[row - 1]);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      for (let c = col + step; c >= 0 && c < STATUSES.length; c += step) {
        const other = columns[STATUSES[c]!];
        if (other.length) return go(other[Math.min(row, other.length - 1)]);
      }
      return go(undefined);
    }
    if (/^[1-4]$/.test(e.key)) {
      e.preventDefault();
      refocus.current = card.id;
      onMove(card, STATUSES[Number(e.key) - 1]!);
      return;
    }
    if (e.key === 'e') {
      e.preventDefault();
      refocus.current = card.id;
      onCycleEffort(card);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      refocus.current = (list[row + 1] ?? list[row - 1])?.id ?? null;
      onDelete(card);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <FilterBar cards={allCards} shown={cards.filter((c) => c.status !== 'complete').length} filter={filter} onFilter={onFilter} />
      <div className="board">
        {STATUSES.map((status) => (
          <Column key={status} status={status} count={columns[status].length + (status === 'not-started' && !idleOpen ? idle.length : 0)} onCreate={onCreate}>
            {columns[status].length === 0 && !(status === 'not-started' && idle.length) ? (
              <p className="column-empty">{filtering && status !== 'complete' ? 'No cards match the filter.' : EMPTY[status]}</p>
            ) : (
              columns[status].map((card) => (
                <DraggableCard
                  key={card.id}
                  card={card}
                  idle={idleIds.has(card.id)}
                  pinned={pinned.includes(card.id)}
                  blocker={blockerOf(card)}
                  blocking={blocking.get(card.id) ?? 0}
                  selected={card.id === selectedId}
                  onOpen={open}
                  onCycleEffort={onCycleEffort}
                  onDelete={onDelete}
                  onKey={onCardKey}
                />
              ))
            )}
            {status === 'not-started' && idle.length > 0 && (
              <IdleStack count={idle.length} open={idleOpen} titles={idle.map((c) => c.title)} onToggle={() => setIdleOpen((o) => !o)} />
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

/** Narrow the board to one project (a linked reference note) and/or a due window. Resets on reload. */
function FilterBar({ cards, shown, filter, onFilter }: { cards: StoredCard[]; shown: number; filter: BoardFilter; onFilter: (f: BoardFilter) => void }) {
  // Every note linked from a card that isn't Complete, with how many cards link to it.
  const notes = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const c of cards) {
      if (c.status === 'complete') continue;
      for (const r of c.refs) {
        const name = refName(r);
        const key = name.toLowerCase();
        const entry = counts.get(key) ?? { name, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);
  const total = cards.filter((c) => c.status !== 'complete').length;
  const filtering = !!(filter.note || filter.due);

  return (
    <div className="filter-bar" role="group" aria-label="Filter the board">
      <label className="filter-project">
        <span className="field-label">Project</span>
        <select aria-label="Filter by project" value={filter.note ?? ''} onChange={(e) => onFilter({ ...filter, note: e.target.value || null })}>
          <option value="">All projects</option>
          {filter.note && !notes.some((n) => n.name.toLowerCase() === filter.note!.toLowerCase()) && <option value={filter.note}>{filter.note}</option>}
          {notes.map((n) => (
            <option key={n.name} value={n.name}>
              {n.name} ({n.count})
            </option>
          ))}
        </select>
      </label>
      <div className="filter-due">
        <span className="field-label">Due</span>
        <div className="segmented" role="group" aria-label="Filter by due date">
          <button className={!filter.due ? 'on' : ''} aria-pressed={!filter.due} onClick={() => onFilter({ ...filter, due: null })}>
            Any time
          </button>
          {DUE_WINDOWS.map((w) => (
            <button key={w} className={filter.due === w ? 'on' : ''} aria-pressed={filter.due === w} onClick={() => onFilter({ ...filter, due: w })}>
              {WINDOW_LABEL[w]}
            </button>
          ))}
        </div>
      </div>
      {filtering && (
        <span className="filter-summary">
          Showing {shown} of {total}
          <button className="link-button" onClick={() => onFilter(NO_FILTER)}>
            Clear filters
          </button>
        </span>
      )}
    </div>
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

/** Folded: a small pile you click to fan out. Open: a button at the end of the faded cards to fold them back. */
function IdleStack({ count, open, titles, onToggle }: { count: number; open: boolean; titles: string[]; onToggle: () => void }) {
  if (open) {
    return (
      <button className="idle-collapse" onClick={onToggle}>
        Fold the {count} idle card{count === 1 ? '' : 's'} back up
      </button>
    );
  }
  return (
    <button
      className="idle-stack"
      onClick={onToggle}
      aria-label={`${count} idle card${count === 1 ? '' : 's'}, untouched ${IDLE_DAYS}+ days. Click to show.`}
      title={titles.slice(0, 8).join('\n') + (titles.length > 8 ? '\n…' : '')}
    >
      {count > 2 && <span className="idle-sheet third" aria-hidden />}
      {count > 1 && <span className="idle-sheet second" aria-hidden />}
      <span className="idle-sheet top">
        <strong>
          {count} idle card{count === 1 ? '' : 's'}
        </strong>
        <span className="muted small">Untouched {IDLE_DAYS}+ days · click to show</span>
      </span>
    </button>
  );
}

function DraggableCard(props: {
  card: StoredCard;
  idle?: boolean;
  pinned?: boolean;
  blocker?: { title: string; done: boolean };
  blocking?: number;
  selected: boolean;
  onOpen: (id: string) => void;
  onCycleEffort: (card: StoredCard) => void;
  onDelete: (card: StoredCard) => void;
  onKey: (card: StoredCard, e: KeyboardEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.card.id });
  const { onKey, idle: _idle, ...tile } = props;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={props.card.title}
      data-card-id={props.card.id}
      className={`card-slot ${isDragging ? 'drag-source' : ''} ${props.idle ? 'idle' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) props.onOpen(props.card.id);
        else onKey(props.card, e);
      }}
    >
      <CardTile {...tile} />
    </div>
  );
}

function CardTile({
  card,
  pinned,
  blocker,
  blocking = 0,
  selected,
  overlay,
  onOpen,
  onCycleEffort,
  onDelete,
}: {
  card: StoredCard;
  pinned?: boolean;
  /** The card this one waits on, and whether it's done. */
  blocker?: { title: string; done: boolean };
  /** How many Blocked cards wait on this one. */
  blocking?: number;
  selected?: boolean;
  overlay?: boolean;
  onOpen?: (id: string) => void;
  onCycleEffort?: (card: StoredCard) => void;
  onDelete?: (card: StoredCard) => void;
}) {
  const due = isUnblockDue(card);
  const dueMark = dueState(card);
  const dueText = card.status !== 'complete' ? dueLabel(card) : null;
  return (
    <article
      className={`card ${selected ? 'selected' : ''} ${overlay ? 'overlay' : ''} ${dueMark ? `due-${dueMark}` : ''} ${blocking ? 'blocking' : ''}`}
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
        {pinned && (
          <span className="card-pin" title="Pinned to today" aria-label="Pinned to today">
            📌
          </span>
        )}
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
      {dueText && <p className={`card-due ${dueMark ?? ''}`}>{dueText}</p>}
      {blocking > 0 && (
        <p className="card-blocking" title="Another card can’t start until this one is finished">
          Blocking {blocking} card{blocking === 1 ? '' : 's'}
        </p>
      )}
      {blocker && (
        <p className={`card-blocker ${blocker.done ? 'due' : ''}`}>
          <span>Blocked by {blocker.title}</span>
          {blocker.done && <span className="unblock-date">Blocker is done — follow up?</span>}
        </p>
      )}
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
