// Vault config shape and defaults. No file access, so the UI can import it too.
export const THEMES = ['auto', 'light', 'dark', 'cozy', 'retro'] as const;
export type Theme = (typeof THEMES)[number];

export interface VaultConfig {
  points: { low: number; medium: number; high: number };
  unblockBonus: number;
  unblockMinHours: number;
  archiveAfterDays: number;
  theme: Theme;
}

export const DEFAULT_CONFIG: VaultConfig = {
  points: { low: 100, medium: 300, high: 750 },
  unblockBonus: 200,
  unblockMinHours: 24,
  archiveAfterDays: 7,
  theme: 'auto',
};
