import { useEffect, useState } from 'react';
import { ShortcutCheck } from './ShortcutCheck.tsx';

interface VaultFile {
  path: string;
  size: number;
  modified: string;
}

interface VaultResponse {
  vaultPath: string;
  files: VaultFile[];
}

function groupByFolder(files: VaultFile[]): [string, VaultFile[]][] {
  const groups = new Map<string, VaultFile[]>();
  for (const f of files) {
    const folder = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : '(vault root)';
    groups.set(folder, [...(groups.get(folder) ?? []), f]);
  }
  return [...groups.entries()];
}

export function App() {
  const [vault, setVault] = useState<VaultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/vault')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Server returned ${r.status}`))))
      .then(setVault)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="page">
      <header className="header">
        <h1>Mindscape</h1>
        <span className="badge">Phase 0</span>
      </header>

      <section className="panel">
        <h2>Vault</h2>
        {error && <p className="error">Couldn't reach the Mindscape server: {error}</p>}
        {!vault && !error && <p className="muted">Loading…</p>}
        {vault && (
          <>
            <p className="mono">{vault.vaultPath}</p>
            {vault.files.length === 0 ? (
              <p className="muted">The vault is empty. Files you add will show up here.</p>
            ) : (
              groupByFolder(vault.files).map(([folder, files]) => (
                <div key={folder} className="folder">
                  <h3>{folder}</h3>
                  <ul>
                    {files.map((f) => (
                      <li key={f.path}>
                        <span className="mono">{f.path}</span>
                        <span className="muted">{new Date(f.modified).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </>
        )}
      </section>

      <ShortcutCheck />
    </main>
  );
}
