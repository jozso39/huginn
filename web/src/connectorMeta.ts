import type { ConnectorKind, ItemKind } from './api.types';
import clickupLogo from './assets/logos/clickup.svg';
import gitlabLogo from './assets/logos/gitlab.svg';
import gmailLogo from './assets/logos/gmail.svg';
import linkedInLogo from './assets/logos/linkedin.svg';
import signalLogo from './assets/logos/signal.svg';
import slackLogo from './assets/logos/slack.svg';

/**
 * How each source is shown. Logos are from the CC0 "svg-logos" set (gilbarbara/logos);
 * the glyph and colour are the fallback for sources without one.
 */
export const CONNECTOR_META: Record<
  ConnectorKind,
  { glyph: string; color: string; label: string; logo?: string }
> = {
  GitLab: { glyph: 'GL', color: '#e0703a', label: 'GitLab', logo: gitlabLogo },
  Slack: { glyph: 'SL', color: '#8a5cc7', label: 'Slack', logo: slackLogo },
  Gmail: { glyph: 'GM', color: '#d0473c', label: 'Gmail', logo: gmailLogo },
  ClickUp: { glyph: 'CU', color: '#6a6ae8', label: 'ClickUp', logo: clickupLogo },
  LinkedIn: { glyph: 'IN', color: '#0a66c2', label: 'LinkedIn', logo: linkedInLogo },
  Signal: { glyph: 'SG', color: '#3a76f0', label: 'Signal', logo: signalLogo },
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
