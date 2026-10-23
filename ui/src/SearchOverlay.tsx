import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_LABELS } from '../../core/cards.ts';
import { formatDay, isDate } from '../../core/daily.ts';
import { SEARCH_KINDS, type SearchKind } from '../../core/searchTypes.ts';
import { type SearchHit, api } from './api.ts';

const GROUP_LABELS: Record<SearchKind, string> = { card: 'Cards', reference: 'Reference notes', daily: 'Daily notes', review: 'Weekly reviews' };
const PER_GROUP = 10;
const DEBOUNCE_MS = 60;

/** Wrap the matched words (at word starts, any case) in <mark>. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = [...terms].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`((?<![\\p{L}\\p{N}])(?:${escaped.join('|')}))`, 'iu'));
  return <>{parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

function titleOf(hit: SearchHit): string {
  return hit.kind === 'daily' && isDate(hit.key) ? formatDay(hit.key, 'dddd, MMMM D, YYYY') : hit.title;
}

interface Props {
  onClose: () => void;
  onOpen: (hit: SearchHit, query: string) => void;
}

/** ⌘K: search everything. Arrows move, Enter opens, Esc closes. */
export function SearchOverlay({ onClose, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [active, setActive] = useState(0);
  const latest = useRef('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .search(q)
        .then((r) => {
          // Ignore answers to queries that have since been typed over.
          if (latest.current !== q) return;
          setResults(r.results);
          setActive(0);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Grouped by kind, in a fixed order; arrow keys walk the groups top to bottom.
  const groups = useMemo(
    () =>
      SEARCH_KINDS.map((kind) => ({ kind, hits: (results ?? []).filter((h) => h.kind === kind) }))
        .filter((g) => g.hits.length)
        .map((g) => ({ ...g, more: g.hits.length - PER_GROUP, hits: g.hits.slice(0, PER_GROUP) })),
    [results],
  );
  const flat = groups.flatMap((g) => g.hits);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onOpen(hit, query.trim());
  };

  let index = -1;
  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal search" role="dialog" aria-label="Search">
        <input
          autoFocus
          className="search-input"
          spellCheck={false}
          autoComplete="off"
          value={query}
          placeholder="Search cards, notes, and days…"
          aria-label="Search"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="search-results"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, flat.length - 1));
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
            else if (e.key === 'Enter') open(flat[active]);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <div className="search-results" id="search-results" role="listbox" aria-label="Results" ref={list}>
          {results !== null && flat.length === 0 && <p className="muted search-empty">Nothing matches “{query.trim()}”.</p>}
          {groups.map((g) => (
            <section key={g.kind} className="search-group" aria-label={GROUP_LABELS[g.kind]}>
              <h3>{GROUP_LABELS[g.kind]}</h3>
              {g.hits.map((hit) => {
                index++;
                const i = index;
                return (
                  <div
                    key={hit.path}
                    role="option"
                    aria-selected={i === active}
                    className={`search-hit ${i === active ? 'active' : ''}`}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => open(hit)}
                  >
                    <div className="search-hit-title">
                      <span>
                        <Highlight text={titleOf(hit)} terms={hit.terms} />
                      </span>
                      {hit.kind === 'card' && (
                        <span className={`status-pill status-${hit.archived ? 'archived' : hit.status}`}>
                          {hit.archived ? 'Archived' : STATUS_LABELS[hit.status!]}
                        </span>
                      )}
                      {hit.path.startsWith('stickies/') && <span className="status-pill">Sticky</span>}
                      {!hit.exact && <span className="muted small">close match</span>}
                    </div>
                    {hit.snippet && (
                      <div className="search-snippet muted">
                        <Highlight text={hit.snippet} terms={hit.terms} />
                      </div>
                    )}
                  </div>
                );
              })}
              {g.more > 0 && <p className="muted small search-more">+{g.more} more — add a word to narrow it down</p>}
            </section>
          ))}
        </div>
        <p className="hint search-hint">↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
