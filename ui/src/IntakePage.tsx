import { useCallback, useEffect, useState } from 'react';
import { EFFORTS, type Effort, type StoredCard } from '../../core/cards.ts';
import { formatDay } from '../../core/daily.ts';
import { PROPOSAL_LABELS, PROPOSAL_TYPES, type ProposalType } from '../../core/intakeTypes.ts';
import { type Decision, type ProposalEdits, type ReviewItem, api } from './api.ts';
import { onVaultChange } from './live.ts';
import { Markdown } from './Markdown.tsx';
import { hrefFor } from './route.ts';
import { useToast } from './Toasts.tsx';

const EFFORT_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High' };

interface Props {
  cards: StoredCard[];
  unprocessedDays: number;
  onRun: (includeToday: boolean) => Promise<void>;
  onUndo: (undoId: string) => void;
}

/** Review what /mindscape proposed: accept, edit then accept, or reject. */
export function IntakePage({ cards, unprocessedDays, onRun, onUndo }: Props) {
  const toast = useToast();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteNames, setNoteNames] = useState<string[]>([]);
  const [includeToday, setIncludeToday] = useState(false);
  const [launching, setLaunching] = useState(false);

  const run = async () => {
    setLaunching(true);
    try {
      await onRun(includeToday);
    } finally {
      // Ignore repeat clicks while Terminal opens.
      window.setTimeout(() => setLaunching(false), 3000);
    }
  };

  const runControls = (big: boolean) => (
    <div className={`run-controls ${big ? 'big' : ''}`}>
      <label className="include-today">
        <input type="checkbox" checked={includeToday} onChange={(e) => setIncludeToday(e.target.checked)} /> Include today
      </label>
      <button className={`button ${big ? 'primary' : 'quiet bordered'}`} disabled={launching} onClick={() => void run()}>
        {launching ? 'Opening Terminal…' : 'Run /mindscape'}
      </button>
    </div>
  );

  const load = useCallback(async () => {
    try {
      setItems((await api.intake()).items);
      setNoteNames((await api.notes()).notes.map((n) => n.name));
    } catch {
      // offline: the header says so
    }
  }, []);

  useEffect(() => {
    void load();
    return onVaultChange(() => void load());
  }, [load]);

  const decide = async (decisions: Decision[]) => {
    if (!decisions.length || busy) return false;
    setBusy(true);
    try {
      const result = await api.decide(decisions);
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length) toast({ message: failed.map((f) => f.error).join(' '), tone: 'error' });
      if (result.results.some((r) => r.ok)) {
        const undoId = result.undoId;
        toast({ message: result.summary, action: undoId ? { label: 'Undo', run: () => onUndo(undoId) } : undefined });
      }
      await load();
      return failed.length === 0;
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (items === null) return <p className="muted page-pad">Loading…</p>;

  const groups = PROPOSAL_TYPES.map((type) => ({ type, items: items.filter((i) => i.proposal.type === type) })).filter((g) => g.items.length);

  return (
    <div className="intake-page">
      <header className="page-header">
        <h2>Intake</h2>
        {items.length > 0 && (
          <span className="muted">
            {items.length} proposal{items.length === 1 ? '' : 's'} from your daily notes
          </span>
        )}
        {items.length > 0 && runControls(false)}
      </header>

      {items.length === 0 && (
        <div className="empty intake-empty">
          <p>Nothing to review.</p>
          <p className="muted">
            {unprocessedDays > 0
              ? `${unprocessedDays} day${unprocessedDays === 1 ? '' : 's'} of daily notes haven’t been processed yet. `
              : 'Your daily notes are all processed. '}
            <code>/mindscape</code> reads the new lines in your daily notes and proposes new cards, card log entries, and reference notes. This
            button opens it in Claude Code, in Terminal; when it’s done, the proposals show up here to accept, edit, or reject.
          </p>
          {runControls(true)}
        </div>
      )}

      {groups.map((g) => (
        <section key={g.type} className="intake-group" aria-label={PROPOSAL_LABELS[g.type]}>
          <div className="intake-group-head">
            <h3>
              {PROPOSAL_LABELS[g.type]} <span className="muted">{g.items.length}</span>
            </h3>
            <div className="row-actions">
              <button
                className="button quiet"
                disabled={busy}
                onClick={() => void decide(g.items.map((i) => ({ runId: i.runId, id: i.proposal.id, action: 'reject' })))}
              >
                Reject all
              </button>
              <button
                className="button primary"
                disabled={busy || g.items.every((i) => i.stale)}
                onClick={() => void decide(g.items.filter((i) => !i.stale).map((i) => ({ runId: i.runId, id: i.proposal.id, action: 'accept' })))}
              >
                Accept all
              </button>
            </div>
          </div>
          {g.items.map((item) => (
            <ProposalCard
              key={`${item.runId}/${item.proposal.id}`}
              item={item}
              cards={cards}
              noteNames={noteNames}
              busy={busy}
              onDecide={(action, edits) => decide([{ runId: item.runId, id: item.proposal.id, action, edits }])}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface CardProps {
  item: ReviewItem;
  cards: StoredCard[];
  noteNames: string[];
  busy: boolean;
  onDecide: (action: 'accept' | 'reject', edits?: ProposalEdits) => Promise<boolean>;
}

function ProposalCard({ item, cards, noteNames, busy, onDecide }: CardProps) {
  const { proposal: p, stale, warning } = item;
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ProposalEdits>({});
  const title = (id: string) => cards.find((c) => c.id === id)?.title ?? 'a card that no longer exists';
  const set = (patch: ProposalEdits) => setEdits((e) => ({ ...e, ...patch }));

  // Start editing from the proposal's current values.
  const startEditing = () => {
    if (p.type === 'new-task') setEdits({ title: p.title, effort: p.effort, refs: p.refs });
    else if (p.type === 'card-log') setEdits({ cardId: p.cardId, text: p.text });
    else if (p.type === 'new-note') setEdits({ name: p.name, text: p.text });
    else setEdits({ note: p.note, text: p.text });
    setEditing(true);
  };

  return (
    <article className={`proposal ${stale ? 'stale' : ''}`} aria-label={summaryOf(p.type)}>
      <a className="proposal-source" href={hrefFor.daily(p.source.date, p.source.quote.slice(0, 40))} title="Open the daily note">
        <span className="muted small">{formatDay(p.source.date, 'ddd, MMM D')}</span>
        <q>{p.source.quote}</q>
      </a>

      {!editing ? (
        <div className="proposal-body">
          {p.type === 'new-task' && (
            <>
              <p>
                Create card <strong>{p.title}</strong> <span className={`effort-tag effort-${p.effort}`}>{EFFORT_NAME[p.effort]}</span>
              </p>
              {p.refs.length > 0 && (
                <p className="muted small">
                  Linked to{' '}
                  {p.refs.map((r, i) => (
                    <span key={r}>
                      {i > 0 && ', '}
                      <a href={hrefFor.note(r)}>{r}</a>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
          {p.type === 'card-log' && (
            <p>
              Add to the log of <strong>{item.cardTitle ?? title(p.cardId)}</strong>: “{p.text}”
            </p>
          )}
          {p.type === 'new-note' && (
            <>
              <p>
                Create note <strong>{p.name}</strong>
                {p.linkCards.length > 0 && <span className="muted"> · linked to {p.linkCards.map(title).join(', ')}</span>}
              </p>
              <Markdown text={p.text} className="proposal-text" />
            </>
          )}
          {p.type === 'note-append' && (
            <>
              <p>
                Add to <a href={hrefFor.note(p.note)}>{p.note}</a>
              </p>
              <Markdown text={p.text} className="proposal-text" />
            </>
          )}
          {p.why && <p className="muted small proposal-why">{p.why}</p>}
        </div>
      ) : (
        <EditFields item={item} edits={edits} set={set} cards={cards} noteNames={noteNames} />
      )}

      {stale && <p className="proposal-stale">{stale}</p>}
      {!stale && warning && <p className="muted small">{warning}</p>}

      <div className="row-actions end">
        {editing ? (
          <>
            <button className="button quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                if (await onDecide('accept', edits)) setEditing(false);
              }}
            >
              Accept with changes
            </button>
          </>
        ) : (
          <>
            <button className="button quiet" disabled={busy} onClick={() => void onDecide('reject')}>
              Reject
            </button>
            <button className="button quiet" onClick={startEditing}>
              Edit
            </button>
            <button className="button primary" disabled={busy || !!stale} onClick={() => void onDecide('accept')}>
              Accept
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function EditFields({
  item,
  edits,
  set,
  cards,
  noteNames,
}: {
  item: ReviewItem;
  edits: ProposalEdits;
  set: (patch: ProposalEdits) => void;
  cards: StoredCard[];
  noteNames: string[];
}) {
  const type = item.proposal.type;
  const textArea = (
    <label className="field">
      <span className="field-label">{type === 'card-log' ? 'Log entry' : 'Text'}</span>
      <textarea rows={type === 'card-log' ? 2 : 5} value={edits.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
    </label>
  );
  return (
    <div className="proposal-edit">
      {type === 'new-task' && (
        <>
          <label className="field">
            <span className="field-label">Card title</span>
            <input value={edits.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <div className="field">
            <span className="field-label">Effort</span>
            <div className="segmented" role="group" aria-label="Effort">
              {EFFORTS.map((e) => (
                <button key={e} type="button" className={edits.effort === e ? 'on' : ''} aria-pressed={edits.effort === e} onClick={() => set({ effort: e })}>
                  {EFFORT_NAME[e]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label">Linked notes (comma-separated)</span>
            <input
              value={(edits.refs ?? []).join(', ')}
              onChange={(e) => set({ refs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              list="intake-note-names"
            />
          </label>
        </>
      )}
      {type === 'card-log' && (
        <>
          <label className="field">
            <span className="field-label">Card</span>
            <select value={edits.cardId ?? ''} onChange={(e) => set({ cardId: e.target.value })}>
              {!cards.some((c) => c.id === edits.cardId) && <option value={edits.cardId}>Choose a card…</option>}
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          {textArea}
        </>
      )}
      {type === 'new-note' && (
        <>
          <label className="field">
            <span className="field-label">Note name</span>
            <input value={edits.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </label>
          {textArea}
        </>
      )}
      {type === 'note-append' && (
        <>
          <label className="field">
            <span className="field-label">Add to note</span>
            <select value={edits.note ?? ''} onChange={(e) => set({ note: e.target.value })}>
              {!noteNames.includes(edits.note ?? '') && <option value={edits.note}>Choose a note…</option>}
              {noteNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {textArea}
        </>
      )}
      <datalist id="intake-note-names">
        {noteNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

function summaryOf(type: ProposalType): string {
  return { 'new-task': 'New task', 'card-log': 'Card log entry', 'new-note': 'New note', 'note-append': 'Addition to a note' }[type];
}
