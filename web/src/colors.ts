import type { CSSProperties } from 'react';

/** Mirrors CONNECTION_COLORS in src/core/connections/Connection.utils.ts (same order). */
export const CONNECTION_COLORS: { color: string; name: string }[] = [
  { color: '#3b82f6', name: 'Blue' },
  { color: '#8b5cf6', name: 'Violet' },
  { color: '#14b8a6', name: 'Teal' },
  { color: '#f97316', name: 'Orange' },
  { color: '#ec4899', name: 'Pink' },
  { color: '#22c55e', name: 'Green' },
  { color: '#eab308', name: 'Yellow' },
  { color: '#06b6d4', name: 'Cyan' },
  { color: '#ef4444', name: 'Red' },
  { color: '#6366f1', name: 'Indigo' },
  { color: '#a3a635', name: 'Olive' },
  { color: '#64748b', name: 'Slate' },
];

/** What the server would pick for a new connection: the first colour nobody has. */
export const nextConnectionColor = (taken: string[]): string => {
  const used = new Set(taken.map((color) => color.toLowerCase()));

  return (
    CONNECTION_COLORS.find((entry) => !used.has(entry.color))?.color ??
    CONNECTION_COLORS[taken.length % CONNECTION_COLORS.length]?.color ??
    '#64748b'
  );
};

/**
 * A connection's colour for tinted surfaces. styles.css only ever mixes a little of it
 * into the theme's own background, so any colour stays a readable shade.
 */
export const tint = (color: string | undefined): CSSProperties =>
  (color ? { '--tint': color } : {}) as CSSProperties;
