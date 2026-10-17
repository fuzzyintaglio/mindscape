import { Component, type ReactNode } from 'react';

/** If the UI hits an unexpected error, show a way back instead of a blank page. Data on disk is unaffected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Mindscape UI error:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong on this page.</h1>
        <p>Your cards and notes are safe — they’re files on disk. Reloading usually fixes it.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload
        </button>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}
