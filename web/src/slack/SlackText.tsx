import type { ReactNode } from 'react';
import { emojiFor } from './emoji';
import { formatSlackDate } from './slackDate';

export interface SlackNames {
  users: Record<string, string>;
  channels: Record<string, string>;
  groups: Record<string, string>;
}

/*
 * A renderer for Slack's mrkdwn, following Slack's own rules:
 * - ```code blocks``` and `inline code` are verbatim: nothing inside is formatted;
 * - *bold*, _italic_, ~strike~ only open after the start, whitespace or punctuation,
 *   and only close before the end, whitespace or punctuation — so snake_case and
 *   2*3*4 stay as they are — and never span lines;
 * - lines starting with > are a quote;
 * - <…> are references: users, channels, groups, @here, dates, links;
 * - &amp; &lt; &gt; are the only escapes.
 * Everything is built as React nodes: message text never becomes HTML.
 */

const unescape = (text: string) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const WORD = /[\p{L}\p{N}]/u;
const MARKERS: Record<string, 'b' | 'i' | 's'> = { '*': 'b', _: 'i', '~': 's' };

const safeHref = (url: string): string | null => (/^(https?:|mailto:)/i.test(url) ? url : null);

const reference = (body: string, names: SlackNames, key: string): ReactNode => {
  const [target = '', label] = body.split('|');

  if (target.startsWith('@')) {
    const id = target.slice(1);

    return (
      <span key={key} className="slack-mention">
        @{label ?? names.users[id] ?? id}
      </span>
    );
  }

  if (target.startsWith('#')) {
    const id = target.slice(1);

    return (
      <span key={key} className="slack-mention">
        #{label ?? names.channels[id] ?? id}
      </span>
    );
  }

  if (target.startsWith('!subteam^')) {
    const id = target.slice('!subteam^'.length);
    const handle = label ?? (names.groups[id] ? `@${names.groups[id]}` : '@group');

    return (
      <span key={key} className="slack-mention">
        {handle.startsWith('@') ? handle : `@${handle}`}
      </span>
    );
  }

  if (target.startsWith('!date^')) {
    // <!date^timestamp^tokens^optional_link|fallback>
    const [, stamp = '', tokens = '', link] = target.split('^');
    const seconds = Number(stamp);
    const text = Number.isFinite(seconds)
      ? formatSlackDate(seconds, tokens)
      : unescape(label ?? '');
    const href = link ? safeHref(link) : null;

    return href ? (
      <a key={key} href={href} target="_blank" rel="noreferrer">
        {text}
      </a>
    ) : (
      <time key={key} dateTime={new Date(seconds * 1000).toISOString()}>
        {text}
      </time>
    );
  }

  if (target.startsWith('!')) {
    // @here, @channel, @everyone
    return (
      <span key={key} className="slack-mention slack-mention--broadcast">
        @{label ?? target.slice(1)}
      </span>
    );
  }

  const href = safeHref(unescape(target));

  return href ? (
    <a key={key} href={href} target="_blank" rel="noreferrer">
      {unescape(label ?? target.replace(/^mailto:/i, ''))}
    </a>
  ) : (
    unescape(body)
  );
};

/** Index of the closing marker for an emphasis opened at `open`, or -1. */
const closingMarker = (text: string, open: number, marker: string): number => {
  for (let i = open + 2; i < text.length; i += 1) {
    const char = text[i];

    if (char === '\n') {
      return -1;
    }

    // References are atomic: a marker inside <…> never closes anything.
    if (char === '<') {
      const end = text.indexOf('>', i);

      i = end === -1 ? i : end;
      continue;
    }

    if (char === marker && text[i - 1] !== ' ' && !WORD.test(text[i + 1] ?? '')) {
      return i;
    }
  }

  return -1;
};

const inline = (text: string, names: SlackNames, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) {
      nodes.push(unescape(plain));
      plain = '';
    }
  };

  const key = () => `${keyPrefix}-${nodes.length}`;

  while (i < text.length) {
    const char = text[i] ?? '';

    if (char === '`') {
      const end = text.indexOf('`', i + 1);

      if (end > i + 1 && !text.slice(i + 1, end).includes('\n')) {
        flush();
        nodes.push(
          <code key={key()} className="slack-code">
            {unescape(text.slice(i + 1, end))}
          </code>
        );
        i = end + 1;
        continue;
      }
    }

    if (char === '<') {
      const end = text.indexOf('>', i + 1);

      if (end > i + 1) {
        flush();
        nodes.push(reference(text.slice(i + 1, end), names, key()));
        i = end + 1;
        continue;
      }
    }

    const tag = MARKERS[char];

    if (tag && !WORD.test(text[i - 1] ?? '') && /\S/.test(text[i + 1] ?? '')) {
      const end = closingMarker(text, i, char);

      if (end !== -1) {
        flush();

        const inner = inline(text.slice(i + 1, end), names, key());

        nodes.push(
          tag === 'b' ? (
            <strong key={key()}>{inner}</strong>
          ) : tag === 'i' ? (
            <em key={key()}>{inner}</em>
          ) : (
            <del key={key()}>{inner}</del>
          )
        );
        i = end + 1;
        continue;
      }
    }

    if (char === ':') {
      const match = /^:([a-z0-9_+'-]+(?:::skin-tone-[2-6])?):/.exec(text.slice(i));
      const emoji = match ? emojiFor(match[1] ?? '') : null;

      if (match && emoji) {
        flush();
        nodes.push(
          <span key={key()} className="slack-emoji" title={match[0]}>
            {emoji}
          </span>
        );
        i += match[0].length;
        continue;
      }
    }

    plain += char;
    i += 1;
  }

  flush();

  return nodes;
};

const QUOTE = /^(&gt;|>)\s?/;

/** Text outside code blocks: quotes grouped, the rest line by line. */
const blocks = (text: string, names: SlackNames, keyPrefix: string): ReactNode[] => {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length > 0) {
      out.push(
        <blockquote key={`${keyPrefix}-q${out.length}`} className="slack-quote">
          {inline(quote.join('\n'), names, `${keyPrefix}-q${out.length}`)}
        </blockquote>
      );
      quote = [];
    }
  };

  lines.forEach((line, index) => {
    if (QUOTE.test(line)) {
      quote.push(line.replace(QUOTE, ''));

      return;
    }

    flushQuote();
    out.push(
      <span key={`${keyPrefix}-l${index}`}>
        {inline(line, names, `${keyPrefix}-l${index}`)}
        {index < lines.length - 1 && '\n'}
      </span>
    );
  });
  flushQuote();

  return out;
};

export const SlackText = ({ text, names }: { text: string; names: SlackNames }) => {
  const parts = text.split(/```([\s\S]*?)```/);

  return (
    <div className="slack-text">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="slack-pre">
            {unescape(part.replace(/^\n/, ''))}
          </pre>
        ) : (
          blocks(part, names, `p${index}`)
        )
      )}
    </div>
  );
};
