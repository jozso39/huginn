import type { ConnectorKind, ItemKind } from './api.types';
import clickupLogo from './assets/logos/clickup.svg';
import gitlabLogo from './assets/logos/gitlab.svg';
import gmailLogo from './assets/logos/gmail.svg';
import linkedInLogo from './assets/logos/linkedin.svg';
import signalLogo from './assets/logos/signal.svg';
import slackLogo from './assets/logos/slack.svg';

/**
 * How each source is shown. Logos are from the CC0 "svg-logos" set (gilbarbara/logos);
 * the glyph and colour are the fallback for sources without one. `spamExample` is the
 * hint in the "why is this spam?" box: a reason that fits that source's messages.
 */
export const CONNECTOR_META: Record<
  ConnectorKind,
  { glyph: string; color: string; label: string; logo?: string; spamExample: string }
> = {
  GitLab: {
    glyph: 'GL',
    color: '#e0703a',
    label: 'GitLab',
    logo: gitlabLogo,
    spamExample: 'e.g. comments from the CI bot never need an answer from me',
  },
  Slack: {
    glyph: 'SL',
    color: '#8a5cc7',
    label: 'Slack',
    logo: slackLogo,
    spamExample: 'e.g. I am working remotely, lunch invitations don’t apply for me in #lunch',
  },
  Gmail: {
    glyph: 'GM',
    color: '#d0473c',
    label: 'Gmail',
    logo: gmailLogo,
    spamExample: 'e.g. newsletters from shops, I never read them',
  },
  ClickUp: {
    glyph: 'CU',
    color: '#6a6ae8',
    label: 'ClickUp',
    logo: clickupLogo,
    spamExample: 'e.g. status changes on tasks I only follow',
  },
  LinkedIn: {
    glyph: 'IN',
    color: '#0a66c2',
    label: 'LinkedIn',
    logo: linkedInLogo,
    spamExample: 'e.g. job alerts, I am not looking for a new job',
  },
  Signal: {
    glyph: 'SG',
    color: '#3a76f0',
    label: 'Signal',
    logo: signalLogo,
    spamExample: 'e.g. forwarded chain messages in the family group',
  },
  Ingest: {
    glyph: 'IN',
    color: '#5a8a6e',
    label: 'Ingest',
    spamExample: 'e.g. automatic alerts that need nothing from me',
  },
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
