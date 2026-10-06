import type { Theme } from './api.types';

/** Read by the script in index.html, so the first paint already has the right theme. */
const STORAGE_KEY = 'huginn.theme';

/** Light or Dark overrides macOS; System leaves it to styles.css's media query. */
export const applyTheme = (theme: Theme) => {
  const root = document.documentElement;

  if (theme === 'System') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme.toLowerCase());
  }

  try {
    localStorage.setItem(STORAGE_KEY, theme.toLowerCase());
  } catch {
    // No storage: the server's setting still applies, just after a moment.
  }
};
