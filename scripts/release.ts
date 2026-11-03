// Usage: bun run release 1.2.3
// Bumps the version, turns CHANGELOG.md's Unreleased into 1.2.3's section, commits, tags
// v1.2.3 and pushes; the Release workflow then builds and publishes the Mac app with that
// section as its notes, and installed copies update within the hour.
import { $ } from 'bun';
import { releaseSection } from './changelog.utils';

const version = process.argv[2] ?? '';

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: bun run release <major.minor.patch>');
  process.exit(1);
}

if ((await $`git status --porcelain`.text()).trim() !== '') {
  console.error('Commit or stash your changes first.');
  process.exit(1);
}

const pkg = (await Bun.file('package.json').json()) as { version: string };

if (pkg.version === version) {
  console.error(`package.json is already at ${version}.`);
  process.exit(1);
}

let changelog: string;

try {
  const today = new Date().toISOString().slice(0, 10);

  changelog = releaseSection(await Bun.file('CHANGELOG.md').text(), version, today);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

await Bun.write('CHANGELOG.md', changelog);

await Bun.write(
  'package.json',
  (await Bun.file('package.json').text()).replace(
    `"version": "${pkg.version}"`,
    `"version": "${version}"`
  )
);
await $`git commit -am ${`Release v${version}`}`;
await $`git tag v${version}`;
await $`git push`;
await $`git push origin v${version}`;
console.log(`Tagged v${version}; GitHub builds it now (Actions → Release).`);
