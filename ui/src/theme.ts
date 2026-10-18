import { useEffect } from 'react';
import type { Theme } from '../../core/configDefaults.ts';
import './themes/light.css';
import './themes/dark.css';
import './themes/cozy.css';
import './themes/retro.css';

/** Applies the chosen theme to <html data-theme>. "auto" follows the macOS light/dark setting. */
export function useTheme(theme: Theme) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
