import { z } from 'zod';
import type { AttentionNotice, IAttentionSink } from '@/core/attention/Attention.types';
import type { IAppShell } from '@/core/updates/AppShell.types';

/** What the Mac app's shell sends first on stdin: the secrets, never in env or argv. */
export interface DesktopSecrets {
  readonly secretKey: string;
  readonly launchToken: string;
}

/** Lines the shell reads from stdout; logs go to stderr so these stay parseable. */
type ShellEvent =
  | { readonly type: 'ready'; readonly port: number }
  | { readonly type: 'badge'; readonly important: number }
  | ({ readonly type: 'notify' } & AttentionNotice)
  | { readonly type: 'restart' };

/** Lines the shell sends after the secrets: an update is installed and waits for a restart. */
const shellMessage = z.object({ type: z.literal('update'), version: z.string().min(1).max(64) });

export type ShellMessage = z.infer<typeof shellMessage>;

/** Long enough for the window's request to get its answer before the shell restarts. */
const RESTART_DELAY_MS = 250;

/**
 * The server's line to the Mac app's shell: JSON lines out on stdout, JSON lines in on
 * stdin. The first stdin line carries the secrets; stdin closing means the shell is
 * gone, so the server must stop too (no orphan holding the accounts).
 */
export class DesktopChannel implements IAttentionSink, IAppShell {
  private readonly reader = Bun.stdin.stream().getReader();
  private buffer = '';

  public async readSecrets(): Promise<DesktopSecrets> {
    const line = await this.nextLine();

    if (line === null) {
      throw new Error('the shell closed stdin before sending the secrets');
    }

    return JSON.parse(line) as DesktopSecrets;
  }

  /** Hands on what the shell says until it goes away; resolves then. */
  public async closed(onMessage: (message: ShellMessage) => void): Promise<void> {
    for (;;) {
      const line = await this.nextLine();

      if (line === null) {
        return;
      }

      const message = shellMessage.safeParse(parseJson(line));

      if (message.success) {
        onMessage(message.data);
      }
    }
  }

  public ready(port: number): void {
    this.send({ type: 'ready', port });
  }

  public badge(important: number): void {
    this.send({ type: 'badge', important });
  }

  public notify(notice: AttentionNotice): void {
    this.send({ type: 'notify', ...notice });
  }

  /** The shell stops this server cleanly, then starts the app again. */
  public restart(): void {
    setTimeout(() => this.send({ type: 'restart' }), RESTART_DELAY_MS);
  }

  private send(event: ShellEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }

  private async nextLine(): Promise<string | null> {
    for (;;) {
      const newline = this.buffer.indexOf('\n');

      if (newline !== -1) {
        const line = this.buffer.slice(0, newline);

        this.buffer = this.buffer.slice(newline + 1);

        return line;
      }

      const { value, done } = await this.reader.read();

      if (done) {
        return null;
      }

      this.buffer += new TextDecoder().decode(value);
    }
  }
}

const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};
