import { useEffect, useState } from 'react';
import { THEMES, type Theme, type VaultConfig } from '../../core/configDefaults.ts';
import { formatPoints } from '../../core/points.ts';
import { type About, api } from './api.ts';

export const THEME_LABELS: Record<Theme, string> = { auto: 'Auto', light: 'Light', dark: 'Dark', cozy: 'Cozy', retro: 'Retro' };
const THEME_NOTES: Record<Theme, string> = {
  auto: 'Light or Dark, following macOS',
  light: 'Clean and quiet',
  dark: 'Easy on the eyes',
  cozy: 'Warm paper and terracotta',
  retro: 'Old desktop, hard edges',
};

/** A tiny board drawn with a theme's own variables. */
function ThemePreview({ theme }: { theme: Exclude<Theme, 'auto'> }) {
  return (
    <span className="theme-preview" data-theme={theme} aria-hidden="true">
      <span className="tp-col">
        <span className="tp-card">
          <span className="tp-chip high" />
          <span className="tp-line" />
        </span>
        <span className="tp-card">
          <span className="tp-chip low" />
          <span className="tp-line short" />
        </span>
      </span>
      <span className="tp-col">
        <span className="tp-card accent">
          <span className="tp-line" />
        </span>
      </span>
    </span>
  );
}

interface Props {
  config: VaultConfig;
  onTheme: (theme: Theme) => void;
  onShowShortcuts: () => void;
}

export function SettingsPage({ config, onTheme, onShowShortcuts }: Props) {
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => {
    api.about().then(setAbout, () => setAbout(null));
  }, []);

  return (
    <div className="settings-page">
      <header className="page-header">
        <h2>Settings</h2>
      </header>

      <section className="settings-section" aria-labelledby="appearance">
        <h3 id="appearance">Appearance</h3>
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t} role="radio" aria-checked={config.theme === t} className={`theme-option ${config.theme === t ? 'on' : ''}`} onClick={() => onTheme(t)}>
              {t === 'auto' ? (
                <span className="theme-auto">
                  <ThemePreview theme="light" />
                  <ThemePreview theme="dark" />
                </span>
              ) : (
                <ThemePreview theme={t} />
              )}
              <span className="theme-name">{THEME_LABELS[t]}</span>
              <span className="muted small">{THEME_NOTES[t]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="keyboard">
        <h3 id="keyboard">Keyboard</h3>
        <p>
          Almost everything has a shortcut. Press <kbd>?</kbd> anywhere to see them.{' '}
          <button className="button bordered small" onClick={onShowShortcuts}>
            Show shortcuts
          </button>
        </p>
      </section>

      <section className="settings-section" aria-labelledby="points">
        <h3 id="points">Points</h3>
        <p>
          Low {formatPoints(config.points.low)} · Medium {formatPoints(config.points.medium)} · High {formatPoints(config.points.high)} · Unblock bonus +
          {formatPoints(config.unblockBonus)} (after {config.unblockMinHours}h in Blocked). Complete cards move to the Archive after {config.archiveAfterDays} days.
        </p>
        <p className="muted small">
          To change these, edit <code>.mindscape/config.json</code> in your vault.
        </p>
      </section>

      <section className="settings-section" aria-labelledby="data">
        <h3 id="data">Data</h3>
        {about && (
          <p>
            Your vault: <code>{about.vaultPath}</code>
          </p>
        )}
        <p>
          <a className="button bordered" href="/api/export" download>
            Export vault as .zip
          </a>
        </p>
        <p className="muted small">
          A complete copy of your vault (cards, notes, daily notes, reviews, archive, and trash) to keep wherever your work allows. Unzipped, it opens in
          Mindscape or Obsidian. The vault’s own history (.git) and your capture token aren’t included; a new token is made when it’s needed.
        </p>
      </section>

      <section className="settings-section" aria-labelledby="about">
        <h3 id="about">About</h3>
        {about ? (
          <p>
            Mindscape {about.version}
            {about.commit && (
              <>
                {' '}
                · <code>{about.commit}</code>
              </>
            )}
            {about.commitDate && <> · updated {new Date(about.commitDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>}
          </p>
        ) : (
          <p className="muted">…</p>
        )}
        <p className="muted small">Opening Mindscape with Mindscape.command checks GitHub for updates and installs them.</p>
      </section>
    </div>
  );
}
