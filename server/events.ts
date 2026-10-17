// Tiny pub/sub for Server-Sent Events: the page listens, and any change to the
// vault (from the app, Claude, or a hand edit) tells it to refresh.
export type Listener = (event: string) => void;

export class EventHub {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: string) {
    for (const fn of this.listeners) fn(event);
  }
}
