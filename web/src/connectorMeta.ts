import type { ConnectorKind, ItemKind } from './api.types';

/** Brand-neutral glyphs and colours per connector; the icon doubles as the deep link. */
export const CONNECTOR_META: Record<
  ConnectorKind,
  { glyph: string; color: string; label: string }
> = {
  GitLab: { glyph: 'GL', color: '#e0703a', label: 'GitLab' },
  Slack: { glyph: 'SL', color: '#8a5cc7', label: 'Slack' },
  Gmail: { glyph: 'GM', color: '#d0473c', label: 'Gmail' },
  ClickUp: { glyph: 'CU', color: '#6a6ae8', label: 'ClickUp' },
  Ingest: { glyph: 'IN', color: '#5a8a6e', label: 'Ingest' },
};

export const KIND_LABEL: Record<ItemKind, string> = {
  Message: 'message',
  DirectMessage: 'direct message',
  Mention: 'mention',
  Email: 'email',
  Todo: 'todo',
  ReviewRequest: 'review request',
  Comment: 'comment',
  Assignment: 'assigned',
  Alert: 'alert',
};

export const QUICK_EMOJI: { name: string; char: string }[] = [
  { name: 'thumbsup', char: '👍' },
  { name: 'white_check_mark', char: '✅' },
  { name: 'eyes', char: '👀' },
  { name: 'pray', char: '🙏' },
  { name: 'raised_hands', char: '🙌' },
  { name: 'joy', char: '😂' },
];

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 60) {
    return RELATIVE.format(seconds, 'second');
  }

  if (abs < 3600) {
    return RELATIVE.format(Math.round(seconds / 60), 'minute');
  }

  if (abs < 86_400) {
    return RELATIVE.format(Math.round(seconds / 3600), 'hour');
  }

  return RELATIVE.format(Math.round(seconds / 86_400), 'day');
};
