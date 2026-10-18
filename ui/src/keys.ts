// Single-key shortcuts only fire when you're not typing somewhere.
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

/** A plain key press: no ⌘, Ctrl, or Option, and not while typing or already handled. */
export function plainKey(e: KeyboardEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented && !isTyping(e.target);
}
