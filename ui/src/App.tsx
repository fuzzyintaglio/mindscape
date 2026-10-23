import { useCallback, useEffect, useRef, useState } from 'react';
import { type BoardFilter, NO_FILTER, STATUS_LABELS, type Status, type StoredCard, nextEffort } from '../../core/cards.ts';
import { STATUSES } from '../../core/cards.ts';
import type { Theme } from '../../core/configDefaults.ts';
import { pinnedIds } from '../../core/pins.ts';
import { newlyEarned, pinEvents } from '../../core/points.ts';
import { toLocalIso } from '../../core/time.ts';
import { type SearchHit, api } from './api.ts';
import { ArchivedCardPanel } from './ArchivedCardPanel.tsx';
import { ArchivePage } from './ArchivePage.tsx';
import { BlockedPrompt } from './BlockedPrompt.tsx';
import { Board, focusCard } from './Board.tsx';
import { CaptureBox } from './CaptureBox.tsx';
import { CardPanel } from './CardPanel.tsx';
import { Celebration, type CelebrationEvent } from './Celebration.tsx';
import { DailyPage, type OpenDaily } from './DailyPage.tsx';
import { IntakePage } from './IntakePage.tsx';
import { plainKey } from './keys.ts';
import { NotePage, NotesPage } from './NotesPage.tsx';
import { PointsStrip, Streaks, isBestWeek } from './PointsStrip.tsx';
import { ReviewPage, ReviewsPage } from './ReviewsPage.tsx';
import { type Route, hrefFor, navigate, useRoute } from './route.ts';
import { SearchOverlay } from './SearchOverlay.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { ShortcutsOverlay } from './ShortcutsOverlay.tsx';
import { useTheme } from './theme.ts';
import { ToastProvider, useToast } from './Toasts.tsx';
import { useBoard } from './useBoard.ts';

export function App() {
  return (
    <ToastProvider>
      <Main />
    </ToastProvider>
  );
}

/** The first word of a search, for jumping to it inside a daily note. */
function firstWord(query: string): string | undefined {
  return query.split(/\s+/).find((w) => w.length > 1);
}

/** `g` then one of these goes to a view. */
const GO_TO: Record<string, () => string> = {
  b: hrefFor.board,
  d: () => hrefFor.daily(),
  n: hrefFor.notes,
  i: hrefFor.intake,
  a: hrefFor.archive,
  r: hrefFor.reviews,
  s: hrefFor.settings,
};

function Main() {
  const board = useBoard();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Board filters last while you move between views, and reset when the page reloads.
  const [filter, setFilter] = useState<BoardFilter>(NO_FILTER);
  const [blockedPrompt, setBlockedPrompt] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [archived, setArchived] = useState<StoredCard | null>(null);
  const [celebration, setCelebration] = useState<CelebrationEvent | null>(null);
  const celebrationId = useRef(0);
  const panelDirty = useRef(false);
  const pageDirty = useRef(false);
  const openDaily = useRef<OpenDaily | null>(null);
  useTheme(board.config.theme);
  const route = useRoute(() => !pageDirty.current || window.confirm('Discard your unsaved changes to this note?'));

  const selected = board.cards.find((c) => c.id === selectedId) ?? null;

  // If the open card disappears (deleted, archived, or removed on disk), close the panel.
  useEffect(() => {
    if (board.loaded && selectedId && !selected) setSelectedId(null);
  }, [board.loaded, selectedId, selected]);

  const confirmLeave = () => !panelDirty.current || window.confirm('Discard your unsaved changes to these notes?');

  const open = (id: string) => {
    setArchived(null);
    if (id === selectedId || !confirmLeave()) return;
    panelDirty.current = false;
    setSelectedId(id);
  };

  // App-wide shortcuts (the `?` overlay lists them). Single keys only fire when you're not typing.
  const keys = useRef({ route, selected: null as StoredCard | null, move: (_c: StoredCard, _s: Status) => {}, cycleEffort: (_c: StoredCard) => {} });
  const goPending = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
        return;
      }
      if (!plainKey(e) || document.querySelector('.modal')) return;
      const { route, selected, move, cycleEffort } = keys.current;
      if (Date.now() < goPending.current) {
        goPending.current = 0;
        const to = GO_TO[e.key];
        if (to) {
          e.preventDefault();
          navigate(to());
        }
        return;
      }
      const onCard = (e.target as HTMLElement | null)?.closest?.('.card-slot');
      if (e.key === '/') setSearching(true);
      else if (e.key === '?') setShowKeys(true);
      else if (e.key === 'g') goPending.current = Date.now() + 1500;
      else if (e.key === 'n') {
        if (route.view !== 'board') navigate(hrefFor.board());
        // The board may need a moment to appear.
        const add = () => document.querySelector<HTMLButtonElement>('.column-not-started .add-card')?.click();
        window.setTimeout(add, route.view === 'board' ? 0 : 60);
      } else if (selected && !onCard && /^[1-4]$/.test(e.key)) move(selected, STATUSES[Number(e.key) - 1]!);
      else if (selected && !onCard && e.key === 'e') cycleEffort(selected);
      else if (route.view === 'board' && e.key.startsWith('Arrow') && !onCard && (e.target === document.body || e.target === document.documentElement)) {
        document.querySelector<HTMLElement>('.card-slot')?.focus();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showArchived = (card: StoredCard) => {
    if (!confirmLeave()) return;
    panelDirty.current = false;
    setSelectedId(null);
    setArchived(card);
  };

  /** Open any card by id: in the side panel if it's on the board, read-only if it's archived. */
  const openAnyCard = async (id: string) => {
    if (cardsRef.current.some((c) => c.id === id)) return open(id);
    try {
      const { card } = await api.card(id);
      if (card.archived || card.path.startsWith('archive/')) showArchived(card);
      else open(card.id);
    } catch {
      toast({ message: 'That card isn’t on the board or in the archive any more (it may have been deleted).' });
    }
  };
  const cardsRef = useRef(board.cards);
  cardsRef.current = board.cards;

  // Card links inside rendered markdown (e.g. a weekly review's "Closed" list) open the card.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.('a[href^="#/card/"]');
      if (!link) return;
      e.preventDefault();
      void openAnyCard(decodeURIComponent(link.getAttribute('href')!.slice('#/card/'.length)));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
    // openAnyCard reads the latest cards through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openHit = async (hit: SearchHit, query: string) => {
    setSearching(false);
    if (hit.kind === 'card') {
      if (!hit.archived) return open(hit.key);
      try {
        showArchived((await api.card(hit.key)).card);
      } catch (err) {
        toast({ message: (err as Error).message, tone: 'error' });
      }
    } else if (hit.kind === 'reference') navigate(hrefFor.note(hit.key));
    else if (hit.kind === 'daily') navigate(hrefFor.daily(hit.key, hit.terms[0] ?? firstWord(query)));
    else navigate(hrefFor.review(hit.key));
  };

  const close = useCallback(() => {
    if (!confirmLeave()) return;
    panelDirty.current = false;
    setSelectedId((id) => {
      // Back to the card on the board, so the keyboard carries on from there.
      if (id) window.setTimeout(() => focusCard(id), 0);
      return null;
    });
  }, []);

  const setPageDirty = useCallback((d: boolean) => {
    pageDirty.current = d;
  }, []);

  const undo = async (undoId: string) => {
    try {
      await api.undo(undoId);
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
    void board.reload();
  };

  const failed = (err: unknown) => {
    toast({ message: (err as Error).message, tone: 'error' });
    void board.reload();
  };

  const move = async (card: StoredCard, to: Status) => {
    if (card.status === to) return;
    board.patchLocal(card.id, { status: to, enteredColumn: toLocalIso() });
    try {
      const { card: saved, undoId } = await api.updateCard(card.id, { status: to });
      board.upsertLocal(saved);
      celebrate(card, saved);
      void board.reload(); // the points strip, right away (e.g. points coming off after leaving Complete)
      toast({
        message: `Moved to ${STATUS_LABELS[to]}`,
        action: undoId ? { label: 'Undo', run: () => void undo(undoId) } : undefined,
      });
      if (to === 'blocked') setBlockedPrompt(card.id);
    } catch (err) {
      failed(err);
    }
  };

  /** Celebrate what a move just earned (completion points, a bonus, or both). Undo never gets here. */
  const celebrate = (before: StoredCard, after: StoredCard) => {
    const pinBefore = pinEvents([before], [board.pins], board.config).length;
    const pinned = pinEvents([after], [board.pins], board.config).slice(pinBefore);
    const earned = [...newlyEarned(before, after, board.config), ...pinned];
    if (!earned.length) return;
    const done = earned.find((e) => e.kind === 'complete');
    const bonus = earned.find((e) => e.kind === 'unblock') ?? earned.find((e) => e.kind === 'pin');
    const total = earned.reduce((n, e) => n + e.points, 0);
    const strip = board.points;
    const after_ = { ...strip, points: strip.points + total };
    setCelebration({
      id: ++celebrationId.current,
      effort: done?.effort ?? null,
      points: done?.points ?? 0,
      bonus: bonus?.points ?? 0,
      bonusLabel: bonus?.kind === 'pin' ? 'Priority started!' : undefined,
      bestWeek: !isBestWeek(strip) && isBestWeek(after_),
    });
    // Show the new total right away; the next reload brings the server's count.
    const today = (new Date().getDay() + 6) % 7;
    board.setData((d) => ({
      ...d,
      points: { ...d.points, points: d.points.points + total, closed: d.points.closed + (done ? 1 : 0), days: d.points.days.map((n, i) => (i === today ? n + total : n)) },
    }));
  };

  const pinned = pinnedIds(board.pins);

  const pinCard = async (id: string) => {
    try {
      const { pins } = await api.pin(id);
      board.setData((d) => ({ ...d, pins }));
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const unpinCard = async (id: string) => {
    try {
      const { pins } = await api.unpin(id);
      board.setData((d) => ({ ...d, pins }));
    } catch (err) {
      failed(err);
    }
  };

  const pinProps = { pinned, config: board.config, onMove: (c: StoredCard, to: Status) => void move(c, to), onPin: (id: string) => void pinCard(id), onUnpin: (id: string) => void unpinCard(id) };

  const restore = async (card: StoredCard) => {
    try {
      const { card: restored, undoId } = await api.restoreCard(card.id);
      setArchived(null);
      board.upsertLocal(restored);
      toast({ message: `Restored “${card.title}” to In Progress`, action: { label: 'Undo', run: () => void undo(undoId) } });
    } catch (err) {
      failed(err);
    }
  };

  const cycleEffort = async (card: StoredCard) => {
    const effort = nextEffort(card.effort);
    board.patchLocal(card.id, { effort });
    try {
      board.upsertLocal((await api.updateCard(card.id, { effort })).card);
    } catch (err) {
      failed(err);
    }
  };

  const remove = async (card: StoredCard) => {
    board.removeLocal(card.id);
    try {
      const { undoId } = await api.deleteCard(card.id);
      toast({ message: `Deleted “${card.title}”`, action: { label: 'Undo', run: () => void undo(undoId) } });
    } catch (err) {
      failed(err);
    }
  };

  const create = async (title: string, status: Status) => {
    try {
      board.upsertLocal((await api.createCard(title, status)).card);
    } catch (err) {
      failed(err);
    }
  };

  const saveBlocker = async (id: string, blockedBy: string | null, unblockBy: string | null) => {
    setBlockedPrompt(null);
    board.patchLocal(id, { blockedBy, unblockBy });
    try {
      board.upsertLocal((await api.updateCard(id, { blockedBy, unblockBy })).card);
    } catch (err) {
      failed(err);
    }
  };

  const runMindscape = async (includeToday: boolean) => {
    try {
      const { skill } = await api.runMindscape(includeToday);
      toast({
        message:
          skill === 'installed'
            ? 'Updated the /mindscape skill and opened Claude Code in Terminal. Proposals show up here when it’s done.'
            : 'Opened Claude Code in Terminal. Proposals show up here when it’s done.',
      });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const setTheme = async (theme: Theme) => {
    board.setData((d) => ({ ...d, config: { ...d.config, theme } }));
    try {
      await api.setTheme(theme);
    } catch (err) {
      failed(err);
    }
  };

  const promptCard = board.cards.find((c) => c.id === blockedPrompt);
  keys.current = { route, selected, move: (c, s) => void move(c, s), cycleEffort: (c) => void cycleEffort(c) };

  // Say so once after an update (the launcher pulls new versions).
  useEffect(() => {
    api.about().then(
      ({ commit }) => {
        if (!commit) return;
        let seen: string | null = null;
        try {
          seen = localStorage.getItem('mindscape.commit');
          localStorage.setItem('mindscape.commit', commit);
        } catch {
          return;
        }
        if (seen && seen !== commit) toast({ message: 'Mindscape was updated to the latest version. Press ? for shortcuts.' });
      },
      () => {},
    );
    // Once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On the daily view a card opens in the right column, in place of the meeting; elsewhere it slides in on the side.
  const inColumn = route.view === 'daily';
  const cardPanel = selected && (
    <CardPanel
      key={selected.id}
      card={selected}
      onClose={close}
      onMove={(c, to) => void move(c, to)}
      onDelete={(c) => void remove(c)}
      onUpdated={board.upsertLocal}
      onDirtyChange={(d) => {
        panelDirty.current = d;
      }}
      pinned={pinned.includes(selected.id)}
      onPin={pinProps.onPin}
      onUnpin={pinProps.onUnpin}
    />
  );

  return (
    <div className={`app ${selected && !inColumn ? 'with-panel' : ''}`}>
      <header className="topbar">
        <div className="topbar-left">
          <h1>Mindscape</h1>
          <nav className="tabs" aria-label="Views">
            <Tab route={route} view="board" href={hrefFor.board()} label="Board" />
            <Tab route={route} view="daily" href={hrefFor.daily()} label="Daily" />
            <Tab route={route} view="notes" href={hrefFor.notes()} label="Notes" />
            <Tab route={route} view="intake" href={hrefFor.intake()} label="Intake" badge={board.intakePending} />
            <Tab route={route} view="archive" href={hrefFor.archive()} label="Archive" />
            <Tab route={route} view="reviews" href={hrefFor.reviews()} label="Reviews" />
          </nav>
        </div>
        <CaptureBox openDaily={openDaily} onUndo={(id) => void undo(id)} onCard={board.upsertLocal} />
        <div className="topbar-right">
          {board.offline && <span className="offline">Can’t reach Mindscape — is it running?</span>}
          {board.loaded && <PointsStrip strip={board.points} streaks={board.streaks} />}
          <button className="icon-button" onClick={() => setShowKeys(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            ?
          </button>
          <a
            className={`icon-button ${route.view === 'settings' ? 'active' : ''}`}
            href={hrefFor.settings()}
            aria-label="Settings"
            title="Settings (g s)"
            aria-current={route.view === 'settings' ? 'page' : undefined}
          >
            ⚙
          </a>
        </div>
      </header>

      {board.problems.length > 0 && (
        <details className="problems">
          <summary>
            ⚠ {board.problems.length} card file{board.problems.length > 1 ? 's' : ''} couldn’t be read — they’re untouched on disk.
          </summary>
          <ul>
            {board.problems.map((p) => (
              <li key={p.path}>
                <code>{p.path}</code> — {p.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="workspace">
        <main className={`view view-${route.view}`}>
          {route.view === 'daily' ? (
            <DailyPage
              date={route.date}
              find={route.find}
              cards={board.cards}
              pins={pinProps}
              points={board.points}
              unprocessedDays={board.unprocessedDays}
              onRunMindscape={() => void runMindscape(true)}
              onOpenCard={open}
              openDaily={openDaily}
              streaks={<Streaks streaks={board.streaks} />}
              cardPanel={inColumn ? cardPanel : null}
              openCardId={inColumn ? (selected?.id ?? null) : null}
              onCloseCard={close}
            />
          ) : route.view === 'intake' ? (
            <IntakePage
              cards={board.cards}
              unprocessedDays={board.unprocessedDays}
              onRun={(includeToday) => runMindscape(includeToday)}
              onUndo={(id) => void undo(id)}
            />
          ) : route.view === 'archive' ? (
            <ArchivePage boardCards={board.cards} config={board.config} onOpenCard={open} onOpenArchived={showArchived} />
          ) : route.view === 'reviews' ? (
            <ReviewsPage />
          ) : route.view === 'review' ? (
            <ReviewPage week={route.week} onDirtyChange={setPageDirty} />
          ) : route.view === 'settings' ? (
            <SettingsPage config={board.config} onTheme={(t) => void setTheme(t)} onShowShortcuts={() => setShowKeys(true)} />
          ) : route.view === 'notes' ? (
            <NotesPage />
          ) : route.view === 'note' ? (
            <NotePage name={route.name} onOpenCard={open} onDirtyChange={setPageDirty} onUndo={(id) => void undo(id)} />
          ) : board.loaded ? (
            <Board
              cards={board.cards}
              pinned={pinned}
              filter={filter}
              onFilter={setFilter}
              selectedId={selectedId}
              onOpen={open}
              onMove={(c, to) => void move(c, to)}
              onCycleEffort={(c) => void cycleEffort(c)}
              onDelete={(c) => void remove(c)}
              onCreate={create}
            />
          ) : (
            <p className="muted loading">Loading…</p>
          )}
        </main>
        {archived && !selected && <ArchivedCardPanel card={archived} onClose={() => setArchived(null)} onRestore={(c) => void restore(c)} />}
        {!inColumn && cardPanel}
      </div>

      {celebration && <Celebration key={celebration.id} event={celebration} onDone={() => setCelebration(null)} />}

      {showKeys && <ShortcutsOverlay onClose={() => setShowKeys(false)} />}

      {searching && <SearchOverlay onClose={() => setSearching(false)} onOpen={(hit, q) => void openHit(hit, q)} />}

      {promptCard && (
        <BlockedPrompt
          card={promptCard}
          onSave={(b, u) => void saveBlocker(promptCard.id, b, u)}
          onSkip={() => setBlockedPrompt(null)}
        />
      )}
    </div>
  );
}

function Tab({ route, view, href, label, badge }: { route: Route; view: Route['view']; href: string; label: string; badge?: number }) {
  const active = route.view === view || (view === 'notes' && route.view === 'note') || (view === 'reviews' && route.view === 'review');
  return (
    <a href={href} className={`tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
      {label}
      {!!badge && (
        <span className="tab-badge" aria-label={`${badge} to review`}>
          {badge}
        </span>
      )}
    </a>
  );
}
