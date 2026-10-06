// Usage: bun run desktop:dev-data [--live]
// Copies the installed app's data into the development build's own folder, so
// `bun run desktop:dev` (or a plain `bun run dev` pointed at it) shows real data.
// Live connections are paused in the copy: a second Slack socket would take half of
// the real app's messages. Polling ones (Gmail, GitLab, …) only read and stay on.
// --live keeps everything on — only when the installed app is not running, so the
// development build is the one Huginn.
import { Database } from 'bun:sqlite';
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const support = join(homedir(), 'Library/Application Support');
const real = join(support, 'cz.cambora.huginn');
const dev = join(support, 'cz.cambora.huginn.dev');

await mkdir(dev, { recursive: true, mode: 0o700 });
await Promise.all(['huginn.db', 'huginn.db-wal', 'huginn.db-shm'].map((f) => rm(join(dev, f), { force: true })));
await copyFile(join(real, 'master.key'), join(dev, 'master.key'));
await chmod(join(dev, 'master.key'), 0o600);

// VACUUM INTO takes a consistent snapshot even while the real app writes.
const source = new Database(join(real, 'huginn.db'));

source.run(`VACUUM INTO '${join(dev, 'huginn.db').replaceAll("'", "''")}'`);
source.close();

const live = process.argv.includes('--live');

if (!live) {
  const copy = new Database(join(dev, 'huginn.db'));

  copy.run("UPDATE connections SET enabled = 0 WHERE kind IN ('Slack', 'Signal')");
  copy.close();
}

console.log(`Copied into ${dev}${live ? ' (everything on)' : ' (Slack and Signal paused there)'}.`);
