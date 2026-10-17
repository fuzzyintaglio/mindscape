import { type FSWatcher, watch } from 'node:fs';

/** True for paths the app should react to (skips .git, temp files, and Finder clutter). */
export function isRelevant(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.includes('.git')) return false;
  const name = parts[parts.length - 1] ?? '';
  return !name.includes('.tmp-') && name !== '.DS_Store';
}

/** Watch the whole vault (macOS supports recursive fs.watch natively) and call `onChange` once per burst. */
export function watchVault(vault: string, onChange: (paths: string[]) => void, debounceMs = 150): FSWatcher {
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(vault, { recursive: true }, (_event, filename) => {
    const rel = filename ? String(filename) : '';
    if (rel && !isRelevant(rel)) return;
    pending.add(rel);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = [...pending];
      pending = new Set();
      onChange(paths);
    }, debounceMs);
  });
  watcher.on('error', (err) => console.error('Vault watcher error:', err));
  return watcher;
}
