import type { GmailMessage } from '@/core/clients/GmailClient/GmailClient.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { ConnectorCapabilities } from '@/core/connectors/Connector.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import type { MailSource } from '@/infrastructure/connectors/GmailConnector/GmailConnector.types';
import {
  bodyText,
  cleanText,
  header,
  htmlBody,
  isFromDomain,
  parseAddresses,
  toItemRaw,
} from '@/infrastructure/connectors/GmailConnector/GmailConnector.utils';
import { LinkedInNotice } from './LinkedInConnector.types';

const LINKEDIN = 'linkedin.com';
const ORIGIN = 'https://www.linkedin.com';

/**
 * LinkedIn has no API for messages or notifications, and answering its mails does not
 * reach the person: items link to LinkedIn, and Done marks the mail read.
 */
export const LINKEDIN_CAPABILITIES: ConnectorCapabilities = {
  reply: false,
  draft: false,
  react: false,
  ack: true,
};

// LinkedIn names the template of every mail in X-LinkedIn-Template, e.g.
// `email_career_insights_01`; it is the most reliable signal. Order matters.
const TEMPLATE_RULES: readonly (readonly [RegExp, LinkedInNotice])[] = [
  [/security|verification|password|login|sign_in/, LinkedInNotice.Security],
  [/messag|inmail/, LinkedInNotice.Message],
  [/invit/, LinkedInNotice.Invitation],
  [/mention|comment|reply|tag/, LinkedInNotice.Mention],
  [/job|career|hiring|recruit/, LinkedInNotice.Job],
];

const SUBJECT_RULES: readonly (readonly [RegExp, LinkedInNotice])[] = [
  [
    /sent you a (new )?message|messaged you|new messages? from|napsal|zprávu/i,
    LinkedInNotice.Message,
  ],
  [/wants to connect|invitation|pozvánk/i, LinkedInNotice.Invitation],
  [/mentioned you|tagged you|commented on|replied to|zmínil/i, LinkedInNotice.Mention],
  [/\bjobs?\b|hiring|openings?|hired/i, LinkedInNotice.Job],
];

export const classifyNotice = (template: string, subject: string, from: string): LinkedInNotice => {
  const byTemplate = TEMPLATE_RULES.find(([pattern]) => pattern.test(template.toLowerCase()));

  if (byTemplate) {
    return byTemplate[1];
  }

  if (/^security/.test(from)) {
    return LinkedInNotice.Security;
  }

  if (/^invitations?@/.test(from)) {
    return LinkedInNotice.Invitation;
  }

  if (/^(jobs|jobalerts|jobs-listings)/.test(from)) {
    return LinkedInNotice.Job;
  }

  return SUBJECT_RULES.find(([pattern]) => pattern.test(subject))?.[1] ?? LinkedInNotice.Update;
};

const KIND: Record<LinkedInNotice, ItemKind> = {
  [LinkedInNotice.Message]: ItemKind.DirectMessage,
  [LinkedInNotice.Invitation]: ItemKind.Todo,
  [LinkedInNotice.Mention]: ItemKind.Mention,
  [LinkedInNotice.Job]: ItemKind.Alert,
  [LinkedInNotice.Security]: ItemKind.Alert,
  [LinkedInNotice.Update]: ItemKind.Alert,
};

/** Most specific first; every mail links the same navigation bar, so order is the point. */
const LINK_PATHS: Record<LinkedInNotice, readonly string[]> = {
  [LinkedInNotice.Message]: ['/messaging/thread/', '/messaging/'],
  [LinkedInNotice.Invitation]: ['/mynetwork/invitation', '/mynetwork/'],
  [LinkedInNotice.Mention]: ['/feed/update/', '/notifications/'],
  [LinkedInNotice.Job]: ['/jobs/view/', '/jobs/'],
  [LinkedInNotice.Security]: ['/mypreferences/'],
  [LinkedInNotice.Update]: ['/feed/update/', '/pulse/', '/feed/'],
};

const FALLBACK_URL: Record<LinkedInNotice, string> = {
  [LinkedInNotice.Message]: `${ORIGIN}/messaging/`,
  [LinkedInNotice.Invitation]: `${ORIGIN}/mynetwork/invitation-manager/`,
  [LinkedInNotice.Mention]: `${ORIGIN}/notifications/`,
  [LinkedInNotice.Job]: `${ORIGIN}/jobs/`,
  [LinkedInNotice.Security]: `${ORIGIN}/mypreferences/d/categories/sign-in-and-security`,
  [LinkedInNotice.Update]: `${ORIGIN}/feed/`,
};

/**
 * LinkedIn links from its mails, as plain paths: the `/comm/` mail prefix and every
 * query parameter (tracking, and sometimes one-click sign-in tokens) are dropped.
 */
export const linkedInLinks = (html: string): readonly string[] =>
  [...html.matchAll(/href\s*=\s*["'](https:\/\/(?:[a-z]+\.)?linkedin\.com\/[^"'\s]*)["']/gi)]
    .map((match) => new URL((match[1] ?? '').replace(/&amp;/g, '&')))
    .map((url) => url.pathname.replace(/^\/comm\//, '/'));

export const deepLink = (notice: LinkedInNotice, html: string): string => {
  const links = linkedInLinks(html);
  const path = LINK_PATHS[notice]
    .map((prefix) => links.find((link) => link.startsWith(prefix)))
    .find((link) => link !== undefined);

  return path ? `${ORIGIN}${path}` : FALLBACK_URL[notice];
};

const PERSON_IN_SUBJECT =
  /^(.+?) (?:sent you a (?:new )?message|just messaged you|wants to connect|mentioned you|tagged you|commented on|replied to)/i;

/** "Jana Nováková via LinkedIn" → Jana Nováková; otherwise the person named in the subject. */
export const personOf = (fromName: string, subject: string): string => {
  const via = /^(.+?) via LinkedIn$/i.exec(fromName.trim());

  return via?.[1] ?? PERSON_IN_SUBJECT.exec(subject)?.[1] ?? (fromName || 'LinkedIn');
};

// Where LinkedIn's footer starts (English and Czech mails); nothing below is news.
const FOOTER =
  /^(This email was intended for|You are receiving|You're receiving|Unsubscribe|Help:|© \d{4} LinkedIn|Tento e-mail|Tento email|Dostáváte|Odhlásit)/i;

export const noticeText = (text: string): string => {
  const lines = cleanText(text).split('\n');
  const end = lines.findIndex((line) => FOOTER.test(line));

  return (end === -1 ? lines : lines.slice(0, end)).join('\n').trim();
};

export const linkedInMailToItem = (
  connectionId: string,
  message: GmailMessage,
  mailbox: string,
  maxBodyChars: number
): NewItem => {
  const raw = toItemRaw(message, mailbox);
  const template = header(message.payload, 'X-LinkedIn-Template');
  const from = raw.from.address.toLowerCase();
  const notice = classifyNotice(template, raw.subject, from);
  const url = deepLink(notice, htmlBody(message.payload) ?? '');
  const thread = /\/messaging\/thread\/([^/]+)/.exec(url)?.[1];

  return {
    connectionId,
    externalId: message.id,
    // Messages in one LinkedIn conversation sit together; the rest per mail thread.
    threadKey: thread ? `messaging:${thread}` : message.threadId,
    kind: KIND[notice],
    author: personOf(raw.from.name, raw.subject),
    title: raw.subject || 'LinkedIn',
    body: (noticeText(bodyText(message.payload)) || (message.snippet ?? '')).slice(0, maxBodyChars),
    url,
    receivedAt: new Date(Number(message.internalDate)),
    features: {
      notice,
      template: template || null,
      fromAddress: from,
      isMessage: notice === LinkedInNotice.Message,
      isInvitation: notice === LinkedInNotice.Invitation,
      isMention: notice === LinkedInNotice.Mention,
    },
    raw,
  };
};

/** LinkedIn's notification mails in one Gmail mailbox, whatever inbox tab they land in. */
export const linkedInMailSource = (): MailSource => ({
  kind: ConnectorKind.LinkedIn,
  capabilities: LINKEDIN_CAPABILITIES,
  backfillQuery: (days) => `in:inbox is:unread newer_than:${days}d from:${LINKEDIN}`,
  accepts: (message) => {
    const labels = message.labelIds ?? [];
    const from = parseAddresses(header(message.payload, 'From'))[0]?.address ?? '';

    return (
      labels.includes('UNREAD') &&
      labels.includes('INBOX') &&
      !labels.includes('SPAM') &&
      !labels.includes('TRASH') &&
      isFromDomain(from, LINKEDIN)
    );
  },
  toItem: linkedInMailToItem,
});
