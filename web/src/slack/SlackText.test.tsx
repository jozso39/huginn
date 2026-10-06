import { describe, expect, test } from 'bun:test';

// Slack shows dates in the viewer's timezone; these tests view from Prague.
process.env.TZ = 'Europe/Prague';

import { renderToStaticMarkup } from 'react-dom/server';
import { formatSlackDate } from './slackDate';
import { SlackText } from './SlackText';

const names = {
  users: { U1: 'Jana' },
  channels: { C1: 'dev' },
  groups: { S1: 'backend' },
};

const html = (text: string) => renderToStaticMarkup(<SlackText text={text} names={names} />);

describe('SlackText renders mrkdwn like Slack', () => {
  test('the message from the field', () => {
    // 1790632800 = Tuesday, September 29th 2026, a date close to "now" in the test.
    const out = renderToStaticMarkup(
      <SlackText
        text="*Today*-<!date^1790632800^{date_long}|Tuesday, September 29, 2026>"
        names={names}
      />
    );

    expect(out).toContain('<strong>Today</strong>-<time');
    expect(out).toContain('Tuesday, September 29th');
  });

  test('bold, italic, strike, nested, and only at word boundaries', () => {
    expect(html('*bold* _it_ ~gone~')).toContain(
      '<strong>bold</strong> <em>it</em> <del>gone</del>'
    );
    expect(html('*bold _and italic_*')).toContain('<strong>bold <em>and italic</em></strong>');
    expect(html('my_long_name and 2*3*4')).toContain('my_long_name and 2*3*4');
    expect(html('* not bold *')).toContain('* not bold *');
    expect(html('*no\nbold*')).not.toContain('<strong>');
  });

  test('code is verbatim; code blocks keep their lines', () => {
    expect(html('run `*not bold* &lt;x&gt;`')).toContain(
      '<code class="slack-code">*not bold* &lt;x&gt;</code>'
    );
    expect(html('```\nline 1\n*line 2*```')).toContain(
      '<pre class="slack-pre">line 1\n*line 2*</pre>'
    );
  });

  test('references resolve to names; labels win', () => {
    const out = html('hi <@U1>, see <#C1> and <#C2|general>, <!subteam^S1> <!here>');

    expect(out).toContain('@Jana');
    expect(out).toContain('#dev');
    expect(out).toContain('#general');
    expect(out).toContain('@backend');
    expect(out).toContain('slack-mention--broadcast">@here');
  });

  test('links are links, only http(s) and mailto, text escaped', () => {
    expect(html('<https://x.io/a?b=1&amp;c=2|the doc>')).toContain(
      '<a href="https://x.io/a?b=1&amp;c=2" target="_blank" rel="noreferrer">the doc</a>'
    );
    expect(html('<mailto:a@b.cz|mail me>')).toContain('href="mailto:a@b.cz"');
    expect(html('<javascript:alert(1)|click>')).not.toContain('href');
    expect(html('a &lt;b&gt; &amp; c')).toContain('a &lt;b&gt; &amp; c');
  });

  test('quotes, emoji and unknown emoji', () => {
    const out = html('&gt; quoted\n&gt; still\nnot :thumbsup::skin-tone-3: :party-parrot:');

    expect(out).toContain('<blockquote class="slack-quote">quoted\nstill</blockquote>');
    expect(out).toContain('👍🏼');
    expect(out).toContain(':party-parrot:');
  });

  test('every emoji Slack knows by name, aliases too, not just the common ones', () => {
    const out = html(':information_source: :satisfied: :point_up::skin-tone-2: :raven:');

    expect(out).toContain('ℹ️');
    expect(out).toContain('😆');
    // A tone follows the base character itself, without its variation selector.
    expect(out).toContain('\u261D\u{1F3FB}');
    expect(out).toContain('🐦‍⬛');
  });
});

describe('Slack date tokens', () => {
  const now = new Date(2026, 8, 29, 12, 0);
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 9, 5).getTime() / 1000;

  test('dates with ordinals; the year only when far away', () => {
    expect(formatSlackDate(at(2026, 8, 29), '{date_num}', now)).toBe('2026-09-29');
    expect(formatSlackDate(at(2026, 8, 1), '{date}', now)).toBe('September 1st');
    expect(formatSlackDate(at(2026, 8, 22), '{date_short}', now)).toBe('Sep 22');
    expect(formatSlackDate(at(2014, 1, 18), '{date_long}', now)).toBe(
      'Tuesday, February 18th, 2014'
    );
    expect(formatSlackDate(at(2026, 8, 13), '{date}', now)).toBe('September 13th');
  });

  test('pretty dates and relative time', () => {
    expect(formatSlackDate(at(2026, 8, 29), '{date_pretty}', now)).toBe('today');
    expect(formatSlackDate(at(2026, 8, 28), '{date_long_pretty}', now)).toBe('yesterday');
    expect(formatSlackDate(at(2026, 8, 30), '{date_short_pretty}', now)).toBe('tomorrow');
    expect(formatSlackDate(now.getTime() / 1000 - 180, '{ago}', now)).toBe('3 minutes ago');
    expect(formatSlackDate(at(2026, 8, 29), 'on {date_short} at {nope}', now)).toBe(
      'on Sep 29 at {nope}'
    );
  });
});
