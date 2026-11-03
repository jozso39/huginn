// CHANGELOG.md: one `## <name>` section per version (`## 0.7.0 — 2026-11-03`), newest
// first, and `## Unreleased` on top while changes wait for a release.

const HEADING = /^## (\S+)/;

const lines = (changelog: string) => changelog.split('\n');

/** Where the section starts (its heading) and ends (the next heading, or the end). */
const bounds = (all: string[], name: string): { start: number; end: number } | null => {
  const start = all.findIndex((line) => HEADING.exec(line)?.[1] === name);

  if (start === -1) {
    return null;
  }

  const next = all.findIndex((line, index) => index > start && HEADING.test(line));

  return { start, end: next === -1 ? all.length : next };
};

/** The text of a section without its heading; null when it is missing or empty. */
export const sectionOf = (changelog: string, name: string): string | null => {
  const all = lines(changelog);
  const found = bounds(all, name);
  const text = found
    ? all
        .slice(found.start + 1, found.end)
        .join('\n')
        .trim()
    : '';

  return text === '' ? null : text;
};

/** Unreleased becomes the section of `version`; fails when there is nothing in it. */
export const releaseSection = (changelog: string, version: string, date: string): string => {
  if (sectionOf(changelog, version) !== null) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }

  if (sectionOf(changelog, 'Unreleased') === null) {
    throw new Error('Write what changed under "## Unreleased" in CHANGELOG.md first.');
  }

  return changelog.replace(/^## Unreleased.*$/m, `## ${version} — ${date}`);
};

/** One line per paragraph or list item: GitHub shows a release's line breaks as they are. */
export const unwrap = (markdown: string): string =>
  markdown
    .split('\n')
    .reduce<string[]>((out, line) => {
      const previous = out.at(-1);
      const continues =
        previous !== undefined &&
        previous.trim() !== '' &&
        line.trim() !== '' &&
        !/^\s*([-*+] |\d+\. |#)/.test(line);

      return continues ? [...out.slice(0, -1), `${previous} ${line.trim()}`] : [...out, line];
    }, [])
    .join('\n');
