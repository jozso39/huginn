import { describe, expect, test } from 'bun:test';
import { releaseSection, sectionOf, unwrap } from './changelog.utils';

const CHANGELOG = `# Changelog

Intro.

## Unreleased

- Settings → Updates.

## 0.6.0 — 2026-10-25

- **Messenger**.
- Gmail.

## 0.5.0 — 2026-10-15

- WhatsApp.
`;

describe('CHANGELOG.md sections', () => {
  test("a version's section, without its heading, up to the next one", () => {
    expect(sectionOf(CHANGELOG, '0.6.0')).toBe('- **Messenger**.\n- Gmail.');
    expect(sectionOf(CHANGELOG, '0.5.0')).toBe('- WhatsApp.');
    expect(sectionOf(CHANGELOG, '0.4.0')).toBeNull();
  });

  test('a release turns Unreleased into the version, dated', () => {
    const released = releaseSection(CHANGELOG, '0.7.0', '2026-11-03');

    expect(released).toContain('## 0.7.0 — 2026-11-03\n\n- Settings → Updates.');
    expect(sectionOf(released, 'Unreleased')).toBeNull();
    expect(sectionOf(released, '0.7.0')).toBe('- Settings → Updates.');
  });

  test('nothing under Unreleased, or a version released twice, stops the release', () => {
    expect(() =>
      releaseSection(CHANGELOG.replace('- Settings → Updates.', ''), '0.7.0', 'x')
    ).toThrow('Write what changed');
    expect(() => releaseSection(CHANGELOG, '0.6.0', 'x')).toThrow('already has a section');
  });

  test('release notes keep one line per item, the way GitHub shows them', () => {
    expect(
      unwrap('- **Messenger**: your own\n  Messenger, read only.\n- Gmail.\n\nA closing\nline.')
    ).toBe('- **Messenger**: your own Messenger, read only.\n- Gmail.\n\nA closing line.');
  });
});
