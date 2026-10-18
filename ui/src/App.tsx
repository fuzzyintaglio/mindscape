import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_LABELS, type Status, type StoredCard, nextEffort } from '../../core/cards.ts';
import { THEMES, type Theme } from '../../core/configDefaults.ts';
import { toLocalIso } from '../../core/time.ts';
import { type SearchHit, api } from './api.ts';
import { ArchivedCardPanel } from './ArchivedCardPanel.tsx';
import { BlockedPrompt } from './BlockedPrompt.tsx';
import { Board } from './Board.tsx';
import { CaptureBox } from './CaptureBox.tsx';
import { CardPanel } from './CardPanel.tsx';
import { DailyPage, type OpenDaily } from './DailyPage.tsx';
import { IntakePage } from './IntakePage.tsx';
import { NotePage, NotesPage } from './NotesPage.tsx';
import { type Route, hrefFor, navigate, useRoute } from './route.ts';
import { SearchOverlay } from './SearchOverlay.tsx';
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

const THEME_LABELS: Record<Theme, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };

function Main() {
  const board = useBoard();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blockedPrompt, setBlockedPrompt] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [archived, setArchived] = useState<StoredCard | null>(null);
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

  // ⌘K anywhere, or "/" when not typing, opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
      if ((e.metaKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openHit = async (hit: SearchHit, query: string) => {
    setSearching(false);
    if (hit.kind === 'card') {
      if (!hit.archived) return open(hit.key);
      try {
        const { card } = await api.card(hit.key);
        if (!confirmLeave()) return;
        panelDirty.current = false;
        setSelectedId(null);
        setArchived(card);
      } catch (err) {
        toast({ message: (err as Error).message, tone: 'error' });
      }
    } else if (hit.kind === 'reference') navigate(hrefFor.note(hit.key));
    else if (hit.kind === 'daily') navigate(hrefFor.daily(hit.key, hit.terms[0] ?? firstWord(query)));
    else toast({ message: `Weekly reviews get their own page in Phase 5. This one is at ${hit.path} in your vault.` });
  };

  const close = useCallback(() => {
    if (!confirmLeave()) return;
    panelDirty.current = false;
    setSelectedId(null);
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
      toast({
        message: `Moved to ${STATUS_LABELS[to]}`,
        action: undoId ? { label: 'Undo', run: () => void undo(undoId) } : undefined,
      });
      if (to === 'blocked') setBlockedPrompt(card.id);
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

  const setTheme = async (theme: Theme) => {
    board.setData((d) => ({ ...d, config: { ...d.config, theme } }));
    try {
      await api.setTheme(theme);
    } catch (err) {
      failed(err);
    }
  };

  const promptCard = board.cards.find((c) => c.id === blockedPrompt);

  return (
    <div className={`app ${selected ? 'with-panel' : ''}`}>
      <header className="topbar">
        <div className="topbar-left">
          <h1>Mindscape</h1>
          <nav className="tabs" aria-label="Views">
            <Tab route={route} view="board" href={hrefFor.board()} label="Board" />
            <Tab route={route} view="daily" href={hrefFor.daily()} label="Daily" />
            <Tab route={route} view="notes" href={hrefFor.notes()} label="Notes" />
            <Tab route={route} view="intake" href={hrefFor.intake()} label="Intake" badge={board.intakePending} />
          </nav>
        </div>
        <CaptureBox openDaily={openDaily} onUndo={(id) => void undo(id)} onCard={board.upsertLocal} />
        <div className="topbar-right">
          {board.offline && <span className="offline">Can’t reach Mindscape — is it running?</span>}
          <label className="theme-picker">
            <span className="sr-only">Theme</span>
            <select value={board.config.theme} onChange={(e) => void setTheme(e.target.value as Theme)} aria-label="Theme">
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
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
            <DailyPage date={route.date} find={route.find} cards={board.cards} onOpenCard={open} openDaily={openDaily} />
          ) : route.view === 'intake' ? (
            <IntakePage cards={board.cards} onUndo={(id) => void undo(id)} />
          ) : route.view === 'notes' ? (
            <NotesPage />
          ) : route.view === 'note' ? (
            <NotePage name={route.name} onOpenCard={open} onDirtyChange={setPageDirty} onUndo={(id) => void undo(id)} />
          ) : board.loaded ? (
            <Board
              cards={board.cards}
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
        {archived && !selected && <ArchivedCardPanel card={archived} onClose={() => setArchived(null)} />}
        {selected && (
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
          />
        )}
      </div>

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
  const active = route.view === view || (view === 'notes' && route.view === 'note');
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
