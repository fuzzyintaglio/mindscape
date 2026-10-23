import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import type { StoredCard } from '../../core/cards.ts';
import { captureLine, taskFromCapture } from '../../core/daily.ts';
import { toLocalDate } from '../../core/time.ts';
import { api } from './api.ts';
import type { OpenDaily } from './DailyPage.tsx';
import { useToast } from './Toasts.tsx';

interface Props {
  /** Today's note, if it's open: captures go straight into its editor so they never collide with typing. */
  openDaily: MutableRefObject<OpenDaily | null>;
  onUndo: (undoId: string) => void;
  /** A "t:" capture made this card. */
  onCard: (card: StoredCard) => void;
}

/** Always in the header. ⌘J to focus, Enter to capture; "t: …" makes a card. */
export function CaptureBox({ openDaily, onUndo, onCard }: Props) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    const open = openDaily.current;
    if (!taskFromCapture(value) && open?.date === toLocalDate() && open.capture(captureLine(value))) {
      setText('');
      toast({ message: 'Captured to today’s note' });
      return;
    }
    setBusy(true);
    try {
      const result = await api.capture(value);
      setText('');
      if (result.kind === 'card') {
        const { card, undoId } = result;
        onCard(card);
        toast({ message: `Added card “${card.title}”`, action: { label: 'Undo', run: () => onUndo(undoId) } });
      } else toast({ message: 'Captured to today’s note' });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="capture">
      <input
        ref={input}
        value={text}
        placeholder="Capture…  (⌘J)"
        aria-label="Quick capture"
        title="Enter adds it to today’s note. Start with “t:” to make a card (“t!” for High effort, “t-” for Low)."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') input.current?.blur();
        }}
      />
    </div>
  );
}
