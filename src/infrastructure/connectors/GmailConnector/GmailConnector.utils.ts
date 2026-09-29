import type { GmailMessage, GmailPart } from '@/core/clients/GmailClient/GmailClient.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import type { GmailItemRaw, MailAddress } from './GmailConnector.types';
import { GmailInboxScope } from './GmailConnector.types';

const CATEGORY_TABS = [
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
] as const;

const NEVER = new Set(['SPAM', 'TRASH', 'DRAFT']);

/** Everyone shares these domains, so sharing one says nothing about who someone is. */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'yahoo.com',
  'seznam.cz',
  'email.cz',
  'centrum.cz',
  'post.cz',
  'proton.me',
  'protonmail.com',
]);

/** Would this message be in the inbox the user asked for? */
export const isWanted = (labelIds: readonly string[], scope: GmailInboxScope): boolean => {
  const labels = new Set(labelIds);

  if (!labels.has('INBOX') || labelIds.some((label) => NEVER.has(label))) {
    return false;
  }

  switch (scope) {
    case GmailInboxScope.PrimaryOnly:
      return !CATEGORY_TABS.some((tab) => labels.has(tab));
    case GmailInboxScope.NoPromotions:
      return !labels.has('CATEGORY_PROMOTIONS');
    default:
      return true;
  }
};

/** The search that finds the same set for the first sync. */
export const backfillQuery = (scope: GmailInboxScope, days: number): string => {
  const tab =
    scope === GmailInboxScope.PrimaryOnly
      ? ' category:primary'
      : scope === GmailInboxScope.NoPromotions
        ? ' -category:promotions'
        : '';

  return `in:inbox is:unread newer_than:${days}d${tab}`;
};

export const header = (part: GmailPart, name: string): string =>
  part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

/** `"Doe, Jane" <jane@x.io>, bob@y.io` → two addresses; commas inside quotes are kept. */
export const parseAddresses = (value: string): MailAddress[] =>
  (value.match(/(?:"[^"]*"|[^,])+/g) ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const angled = /^(.*?)\s*<([^>]+)>$/.exec(entry);

      return angled
        ? {
            name: (angled[1] ?? '').replace(/^"|"$/g, '').trim(),
            address: (angled[2] ?? '').trim(),
          }
        : { name: '', address: entry };
    });

const decode = (data: string): string => Buffer.from(data, 'base64url').toString('utf8');

const findPart = (part: GmailPart, mimeType: string): GmailPart | null => {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) {
    return part;
  }

  return (part.parts ?? []).reduce<GmailPart | null>(
    (found, child) => found ?? findPart(child, mimeType),
    null
  );
};

const hasAttachment = (part: GmailPart): boolean =>
  Boolean(part.filename) || (part.parts ?? []).some(hasAttachment);

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

/** Lines that introduce the quoted previous message, in the languages Jozef mails in. */
const QUOTE_INTRO =
  /^(On|Dne|Am|Le|El)\b.*(wrote|napsal|napsala|napsal\(a\)|schrieb|a écrit|escribió):?\s*$/i;
const QUOTE_DIVIDER = /^-{2,}\s*(Original Message|Původní zpráva|Forwarded message)/i;

/** Drops the quoted history under a reply; the dashboard shows what is new. */
export const stripQuoted = (text: string): string => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line) => QUOTE_INTRO.test(line.trim()) || QUOTE_DIVIDER.test(line.trim())
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).filter((line) => !line.startsWith('>'));

  return kept.join('\n').trim();
};

/** A URL this long is a tracking link; in a preview it is noise. */
const LONG_URL = /https?:\/\/\S{40,}/g;

/**
 * The preview text: tracking links, divider lines and layout whitespace removed.
 * The full message, links and all, is one click away as HTML.
 */
export const cleanText = (text: string): string =>
  text
    .replace(/\r\n/g, '\n')
    .replace(LONG_URL, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => !/^[-=_*~#.·•|]{3,}$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Upper bound for one e-mail's HTML; newsletters beyond this are cut. */
const MAX_HTML_BYTES = 400_000;

export const htmlBody = (payload: GmailPart): string | null => {
  const part = findPart(payload, 'text/html');

  return part?.body?.data ? decode(part.body.data) : null;
};

/**
 * Defence in depth only: the dashboard shows mail in a sandboxed frame with no
 * scripts and no network. This strips what never belongs there anyway, so the
 * frame has less to refuse.
 */
export const sanitizeEmailHtml = (html: string): string =>
  html
    .slice(0, MAX_HTML_BYTES)
    .replace(
      /<(script|iframe|object|embed|frameset|frame|applet|noscript)\b[\s\S]*?<\/\1\s*>/gi,
      ''
    )
    .replace(/<(script|iframe|object|embed|frame|applet|meta|base|link)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /(href|src|action)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi,
      '$1="#"'
    );

export const bodyText = (payload: GmailPart): string => {
  const plain = findPart(payload, 'text/plain');

  if (plain?.body?.data) {
    return decode(plain.body.data);
  }

  const html = findPart(payload, 'text/html');

  return html?.body?.data ? htmlToText(decode(html.body.data)) : '';
};

export const toItemRaw = (message: GmailMessage, mailbox: string): GmailItemRaw => {
  const from = parseAddresses(header(message.payload, 'From'))[0] ?? { name: '', address: '' };

  return {
    id: message.id,
    threadId: message.threadId,
    mailbox,
    from,
    replyTo: parseAddresses(header(message.payload, 'Reply-To')),
    subject: header(message.payload, 'Subject'),
    messageId: header(message.payload, 'Message-ID'),
    references: header(message.payload, 'References'),
    labelIds: message.labelIds ?? [],
  };
};

export const gmailUrl = (mailbox: string, threadId: string): string =>
  `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${threadId}`;

export const messageToItem = (
  connectionId: string,
  message: GmailMessage,
  mailbox: string,
  maxBodyChars: number
): NewItem => {
  const raw = toItemRaw(message, mailbox);
  const me = mailbox.toLowerCase();
  const myDomain = me.split('@')[1] ?? '';
  const fromDomain = raw.from.address.split('@')[1]?.toLowerCase() ?? null;
  const to = parseAddresses(header(message.payload, 'To'));
  const cc = parseAddresses(header(message.payload, 'Cc'));
  const labels = message.labelIds ?? [];
  const body = cleanText(stripQuoted(bodyText(message.payload))) || (message.snippet ?? '');
  const category = CATEGORY_TABS.find((tab) => labels.includes(tab))?.replace('CATEGORY_', '');

  return {
    connectionId,
    externalId: message.id,
    threadKey: message.threadId,
    kind: ItemKind.Email,
    author: raw.from.name || raw.from.address,
    title: raw.subject || '(no subject)',
    body: body.slice(0, maxBodyChars),
    url: gmailUrl(mailbox, message.threadId),
    receivedAt: new Date(Number(message.internalDate)),
    features: {
      fromAddress: raw.from.address.toLowerCase(),
      fromDomain,
      // A colleague: same organisation domain as the mailbox (never gmail.com & co).
      sameDomain: fromDomain === myDomain && !PUBLIC_MAIL_DOMAINS.has(myDomain),
      toMe: to.some((a) => a.address.toLowerCase() === me),
      ccMe: cc.some((a) => a.address.toLowerCase() === me),
      recipients: to.length + cc.length,
      // List-Unsubscribe / List-Id / Precedence are what bulk senders set; strong spam signal.
      isBulk:
        header(message.payload, 'List-Unsubscribe') !== '' ||
        header(message.payload, 'List-Id') !== '' ||
        /bulk|list/i.test(header(message.payload, 'Precedence')),
      category: category ?? 'PRIMARY',
      isReply: header(message.payload, 'In-Reply-To') !== '',
      hasAttachments: hasAttachment(message.payload),
      isImportant: labels.includes('IMPORTANT'),
      labels: labels.join(','),
    },
    raw,
  };
};

/** RFC 2047: headers are ASCII; anything else goes in as a UTF-8 encoded word. */
export const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const formatAddress = (address: MailAddress): string =>
  address.name ? `${encodeHeader(address.name)} <${address.address}>` : address.address;

/**
 * A plain-text reply to the sender (or Reply-To), threaded with In-Reply-To and
 * References so every client shows it in the same conversation.
 */
export const buildReply = (raw: GmailItemRaw, text: string): string => {
  const recipients = raw.replyTo.length > 0 ? raw.replyTo : [raw.from];
  const subject = /^re:/i.test(raw.subject) ? raw.subject : `Re: ${raw.subject}`;
  const references = [raw.references, raw.messageId].filter((part) => part !== '').join(' ');
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  const message = [
    `To: ${recipients.map(formatAddress).join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    ...(raw.messageId ? [`In-Reply-To: ${raw.messageId}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    ...(body.match(/.{1,76}/g) ?? []),
  ].join('\r\n');

  return Buffer.from(message, 'utf8').toString('base64url');
};
