import { useEffect, useState } from 'react';
import type { Effort } from '../../core/cards.ts';
import { formatPoints } from '../../core/points.ts';

export interface CelebrationEvent {
  id: number;
  /** Set when the card was just completed. */
  effort: Effort | null;
  points: number;
  bonus: number;
  /** This change made it the best week yet. */
  bestWeek: boolean;
}

const SHOW_MS = { low: 1400, medium: 1900, high: 2600, bonus: 1600 };

export const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The theme's confetti colors (`--confetti`, a comma-separated list). */
function themeColors(): string[] | undefined {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--confetti');
  const colors = raw.split(',').map((c) => c.trim()).filter(Boolean);
  return colors.length ? colors : undefined;
}

/** Where confetti starts: the Complete column if it's on screen, else the top middle. */
function origin(): { x: number; y: number } {
  const col = document.querySelector('.column-complete');
  if (!col) return { x: 0.5, y: 0.3 };
  const r = col.getBoundingClientRect();
  return { x: (r.left + r.width / 2) / window.innerWidth, y: Math.min(0.5, (r.top + 60) / window.innerHeight) };
}

/** False where there's no 2D canvas to draw confetti on. */
function canDraw(): boolean {
  try {
    return !!document.createElement('canvas').getContext('2d');
  } catch {
    return false;
  }
}

async function burst(effort: Effort, best: boolean) {
  if ((effort === 'low' && !best) || !canDraw()) return;
  const confetti = await import('canvas-confetti').then(
    (m) => m.default,
    () => null, // no confetti is fine
  );
  if (!confetti) return;
  const colors = themeColors();
  const at = origin();
  const base = { colors, origin: at, disableForReducedMotion: true, zIndex: 60 };
  if (effort === 'medium') confetti({ ...base, particleCount: 60, spread: 65, startVelocity: 32, scalar: 0.9 });
  if (effort === 'high') {
    confetti({ ...base, particleCount: 120, spread: 90, startVelocity: 45 });
    window.setTimeout(() => confetti({ ...base, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } }), 180);
    window.setTimeout(() => confetti({ ...base, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } }), 300);
  }
  if (best) window.setTimeout(() => confetti({ ...base, particleCount: 40, spread: 360, startVelocity: 25, shapes: ['star'], scalar: 1.2 }), 450);
}

/** Counts up to `to` (High-effort cards). Shows the number straight away with reduced motion. */
function useCountUp(to: number, run: boolean): number {
  const [n, setN] = useState(run ? 0 : to);
  useEffect(() => {
    if (!run) return;
    const started = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - started) / 900);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Animation frames pause while the page is hidden; always land on the real number.
    const land = window.setTimeout(() => setN(to), 950);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(land);
    };
  }, [to, run]);
  return n;
}

/**
 * The moment a card is completed: Low gets a check-mark pop, Medium a small confetti
 * burst, High a big one with the points counting up. Leaving Blocked after a long
 * wait gets its own "Unblocked! +200". With Reduce motion on: a soft color pulse
 * and the number, no confetti.
 */
export function Celebration({ event, onDone }: { event: CelebrationEvent; onDone: () => void }) {
  const calm = reducedMotion();
  const kind = event.effort ?? 'bonus';
  const shown = useCountUp(event.points, event.effort === 'high' && !calm);

  useEffect(() => {
    if (!calm && event.effort) void burst(event.effort, event.bestWeek);
    const t = window.setTimeout(onDone, SHOW_MS[kind]);
    return () => window.clearTimeout(t);
    // One celebration per event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  return (
    <div className={`celebration celebration-${kind} ${calm ? 'calm' : ''}`} role="status" aria-live="polite">
      {event.effort ? (
        <>
          <span className="celebration-check" aria-hidden="true">
            ✓
          </span>
          <span className="celebration-points">+{formatPoints(shown)}</span>
          {event.bonus > 0 && <span className="celebration-extra">Unblocked +{formatPoints(event.bonus)}</span>}
        </>
      ) : (
        <>
          <span className="celebration-label">Unblocked!</span>
          <span className="celebration-points">+{formatPoints(event.bonus)}</span>
        </>
      )}
      {event.bestWeek && <span className="celebration-best">★ New best week</span>}
    </div>
  );
}
