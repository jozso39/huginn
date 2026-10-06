// Usage: bun run release 1.2.3
// Bumps the version, commits, tags v1.2.3 and pushes; the Release workflow then builds
// and publishes the Mac app, and installed copies update within the hour.
import { $ } from 'bun';

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
