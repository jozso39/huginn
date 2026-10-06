// Usage: bun run desktop:dev-data [--live | --back]
// Copies the installed app's data into the development build's own folder, so
// `bun run desktop:dev` (or a plain `bun run dev` pointed at it) shows real data.
// Live connections are paused in the copy: a second Slack socket would take half of
// the real app's messages, a second signal-cli half of Signal's. Polling ones (Gmail,
// GitLab, …) only read and stay on.
// --live keeps everything on — only when the installed app is not running, so the
// development build is the one Huginn.
// --back is the way home: the development build's data goes to the installed app,
// everything on there and Slack and Signal paused here. Quit both apps first.
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const support = join(homedir(), 'Library/Application Support');
const real = join(support, 'cz.cambora.huginn');
const dev = join(support, 'cz.cambora.huginn.dev');
const back = process.argv.includes('--back');
const live = back || process.argv.includes('--live');
const [from, to] = back ? [dev, real] : [real, dev];

const pauseLiveConnections = (folder: string) => {
  const db = new Database(join(folder, 'huginn.db'));

  db.run("UPDATE connections SET enabled = 0 WHERE kind IN ('Slack', 'Signal')");
  db.close();
};

await mkdir(to, { recursive: true, mode: 0o700 });
await Promise.all(['huginn.db', 'huginn.db-wal', 'huginn.db-shm'].map((f) => rm(join(to, f), { force: true })));
await copyFile(join(from, 'master.key'), join(to, 'master.key'));
await chmod(join(to, 'master.key'), 0o600);

// VACUUM INTO takes a consistent snapshot even while the other app writes.
const source = new Database(join(from, 'huginn.db'));

source.run(`VACUUM INTO '${join(to, 'huginn.db').replaceAll("'", "''")}'`);
source.close();

// signal-cli's folder holds the linked phone's keys. Going back it is moved, not copied:
// two copies of one linked device must never both run.
if (existsSync(join(from, 'signal'))) {
  await rm(join(to, 'signal'), { recursive: true, force: true });
  await (back ? rename : (a: string, b: string) => cp(a, b, { recursive: true }))(
    join(from, 'signal'),
    join(to, 'signal')
  );
}

if (back) {
  pauseLiveConnections(from);
} else if (!live) {
  pauseLiveConnections(to);
}

console.log(
  back
    ? `Moved back into ${to}; Slack and Signal are paused in ${from}.`
    : `Copied into ${to}${live ? ' (everything on)' : ' (Slack and Signal paused there)'}.`
);
