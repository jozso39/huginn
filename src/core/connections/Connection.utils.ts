/**
 * Colours a connection can tint its items with. The inbox mixes a little of one into
 * its own background, so even a bright pick stays a quiet shade and text stays
 * readable in both themes. Order matters: new connections take the first unused one,
 * and migration 0007 gave existing ones these in this order.
 */
export const CONNECTION_COLORS: readonly string[] = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
  '#22c55e', // green
  '#eab308', // yellow
  '#06b6d4', // cyan
  '#ef4444', // red
  '#6366f1', // indigo
  '#a3a635', // olive
  '#64748b', // slate
];

export const isHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

/** The first palette colour no connection has yet; when all are taken, round again. */
export const nextConnectionColor = (taken: readonly string[]): string => {
  const used = new Set(taken.map((color) => color.toLowerCase()));

  return (
    CONNECTION_COLORS.find((color) => !used.has(color)) ??
    CONNECTION_COLORS[taken.length % CONNECTION_COLORS.length] ??
    '#64748b'
  );
};
