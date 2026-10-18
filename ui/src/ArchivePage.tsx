import { useCallback, useEffect, useMemo, useState } from 'react';
import { EFFORTS, type Effort, type StoredCard } from '../../core/cards.ts';
import type { VaultConfig } from '../../core/configDefaults.ts';
import { formatDay } from '../../core/daily.ts';
import { refName } from '../../core/links.ts';
import { formatPoints } from '../../core/points.ts';
import { toLocalDate } from '../../core/time.ts';
import { type FileProblem, api } from './api.ts';
import { onVaultChange } from './live.ts';
import { useToast } from './Toasts.tsx';

const EFFORT_NAME: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const EFFORT_LETTER: Record<Effort, string> = { low: 'L', medium: 'M', high: 'H' };

export const PRESETS = {
  all: 'All time',
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-quarter': 'This quarter',
  'last-quarter': 'Last quarter',
  'this-year': 'This year',
  'last-year': 'Last year',
  custom: 'Custom dates',
} as const;
export type Preset = keyof typeof PRESETS;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate(); // m is 0-based

/** The date range (inclusive, YYYY-MM-DD) a preset covers; empty strings mean open-ended. */
export function presetRange(preset: Preset, today: string = toLocalDate()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const month = (yy: number, mm: number, months = 1) => {
    const end = new Date(yy, mm - 1 + months - 1, 1);
    return { from: `${yy}-${pad(mm)}-01`, to: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(lastDay(end.getFullYear(), end.getMonth()))}` };
  };
  const q = Math.floor((m - 1) / 3) * 3 + 1; // first month of this quarter
  switch (preset) {
    case 'this-month':
      return month(y, m);
    case 'last-month':
      return m === 1 ? month(y - 1, 12) : month(y, m - 1);
    case 'this-quarter':
      return month(y, q, 3);
    case 'last-quarter':
      return q === 1 ? month(y - 1, 10, 3) : month(y, q - 3, 3);
    case 'this-year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last-year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: '', to: '' };
  }
}

const completedDay = (c: StoredCard) => (c.completed ? toLocalDate(new Date(c.completed)) : '');

/** The cards as a markdown list, for pasting into a self-review. */
export function asList(cards: StoredCard[]): string {
  return cards.map((c) => `- ${c.title} (${EFFORT_NAME[c.effort]}, completed ${formatDay(completedDay(c), 'MMM D, YYYY')})`).join('\n');
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall back for browsers that block the clipboard API
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand?.('copy');
  area.remove();
  if (!ok) throw new Error('Couldn’t copy — your browser blocked the clipboard.');
}

interface Props {
  /** Board cards; Complete ones not yet archived are listed too. */
  boardCards: StoredCard[];
  config: VaultConfig;
  onOpenCard: (id: string) => void;
  onOpenArchived: (card: StoredCard) => void;
}

/** Everything you've completed, for looking back (e.g. at review time). */
export function ArchivePage({ boardCards, config, onOpenCard, onOpenArchived }: Props) {
  const toast = useToast();
  const [archived, setArchived] = useState<StoredCard[] | null>(null);
  const [problems, setProblems] = useState<FileProblem[]>([]);
  const [preset, setPreset] = useState<Preset>('all');
  const [range, setRange] = useState(presetRange('all'));
  const [efforts, setEfforts] = useState<Set<Effort>>(new Set(EFFORTS));
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.archive();
      setArchived(data.cards);
      setProblems(data.problems);
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    void load();
    return onVaultChange(() => void load());
  }, [load]);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };

  const toggleEffort = (e: Effort) =>
    setEfforts((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next.size ? next : new Set(EFFORTS);
    });

  const onBoard = useMemo(() => new Set(boardCards.map((c) => c.id)), [boardCards]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...boardCards.filter((c) => c.status === 'complete'), ...(archived ?? []).filter((c) => !onBoard.has(c.id))];
    return all
      .filter((c) => {
        const day = completedDay(c);
        if (!day || (range.from && day < range.from) || (range.to && day > range.to)) return false;
        if (!efforts.has(c.effort)) return false;
        const hay = `${c.title}\n${c.notes}\n${c.refs.map(refName).join(' ')}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => (b.completed ?? '').localeCompare(a.completed ?? '') || a.title.localeCompare(b.title));
  }, [archived, boardCards, onBoard, range, efforts, query]);

  const months = useMemo(() => {
    const groups = new Map<string, StoredCard[]>();
    for (const c of shown) {
      const key = completedDay(c).slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return [...groups.entries()];
  }, [shown]);

  const points = shown.reduce((n, c) => n + config.points[c.effort], 0);

  const copy = async () => {
    try {
      await copyText(asList(shown));
      toast({ message: `Copied ${shown.length} card${shown.length === 1 ? '' : 's'} as a list.` });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="archive-page">
      <header className="page-header">
        <h2>Archive</h2>
        <p className="muted small">Everything you’ve completed. Cards move here 7 days after they’re done; nothing is ever deleted.</p>
      </header>

      <div className="archive-filters">
        <select aria-label="Date range" value={preset} onChange={(e) => choosePreset(e.target.value as Preset)}>
          {(Object.keys(PRESETS) as Preset[]).map((p) => (
            <option key={p} value={p}>
              {PRESETS[p]}
            </option>
          ))}
        </select>
        <label className="date-field">
          <span className="sr-only">From</span>
          <input
            type="date"
            aria-label="From"
            value={range.from}
            onChange={(e) => {
              setPreset('custom');
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
          />
        </label>
        <span className="muted">to</span>
        <label className="date-field">
          <span className="sr-only">To</span>
          <input
            type="date"
            aria-label="To"
            value={range.to}
            onChange={(e) => {
              setPreset('custom');
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
          />
        </label>
        <div className="effort-filter" role="group" aria-label="Effort">
          {EFFORTS.map((e) => (
            <button
              key={e}
              className={`effort-toggle effort-${e} ${efforts.has(e) ? 'on' : ''}`}
              aria-pressed={efforts.has(e)}
              title={`${EFFORT_NAME[e]} effort`}
              onClick={() => toggleEffort(e)}
            >
              {EFFORT_NAME[e]}
            </button>
          ))}
        </div>
        <input className="archive-search" type="search" placeholder="Filter…" aria-label="Filter archive" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="archive-summary">
        <span>
          <strong>{shown.length}</strong> card{shown.length === 1 ? '' : 's'} · {formatPoints(points)} pts
        </span>
        <button className="button bordered small" disabled={!shown.length} onClick={() => void copy()}>
          Copy as list
        </button>
      </div>

      {problems.length > 0 && (
        <details className="problems">
          <summary>
            ⚠ {problems.length} archived file{problems.length > 1 ? 's' : ''} couldn’t be read — they’re untouched on disk.
          </summary>
          <ul>
            {problems.map((p) => (
              <li key={p.path}>
                <code>{p.path}</code> — {p.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      {archived === null ? (
        <p className="muted">Loading…</p>
      ) : months.length === 0 ? (
        <p className="muted empty-archive">
          {archived.length || boardCards.some((c) => c.status === 'complete') ? 'Nothing matches these filters.' : 'Nothing completed yet. Finished cards collect here.'}
        </p>
      ) : (
        months.map(([month, cards]) => (
          <section key={month} className="archive-month" aria-label={formatDay(`${month}-01`, 'MMMM YYYY')}>
            <h3>
              {formatDay(`${month}-01`, 'MMMM YYYY')} <span className="muted small">{cards.length}</span>
            </h3>
            <ul className="archive-list">
              {cards.map((c) => (
                <li key={c.id}>
                  <button className="archive-row" onClick={() => (onBoard.has(c.id) ? onOpenCard(c.id) : onOpenArchived(c))}>
                    <span className={`effort-tag effort-${c.effort}`} title={`${EFFORT_NAME[c.effort]} effort`}>
                      {EFFORT_LETTER[c.effort]}
                    </span>
                    <span className="archive-title">{c.title}</span>
                    {onBoard.has(c.id) && <span className="tag">on the board</span>}
                    {c.refs.length > 0 && <span className="muted small archive-refs">{c.refs.map(refName).join(', ')}</span>}
                    <span className="muted small archive-date">{formatDay(completedDay(c), 'ddd MMM D')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
