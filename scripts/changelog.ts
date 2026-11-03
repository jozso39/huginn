// Usage: bun scripts/changelog.ts 1.2.3
// Prints what changed in 1.2.3 (its CHANGELOG.md section): the release workflow makes it
// the release's notes. Fails when the section is missing, so no release goes out without.
import { sectionOf, unwrap } from './changelog.utils';

const version = process.argv[2] ?? '';
const notes = sectionOf(await Bun.file('CHANGELOG.md').text(), version);

if (notes === null) {
  console.error(`CHANGELOG.md has no section for "${version}".`);
  process.exit(1);
}

console.log(unwrap(notes));
