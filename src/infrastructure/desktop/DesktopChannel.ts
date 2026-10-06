import type { AttentionNotice, IAttentionSink } from '@/core/attention/Attention.types';

/** What the Mac app's shell sends first on stdin: the secrets, never in env or argv. */
export interface DesktopSecrets {
  readonly secretKey: string;
  readonly launchToken: string;
}

/** Lines the shell reads from stdout; logs go to stderr so these stay parseable. */
type ShellEvent =
  | { readonly type: 'ready'; readonly port: number }
  | { readonly type: 'badge'; readonly important: number }
  | ({ readonly type: 'notify' } & AttentionNotice);

/**
 * The server's line to the Mac app's shell: JSON lines out on stdout, JSON lines in on
 * stdin. The first stdin line carries the secrets; stdin closing means the shell is
 * gone, so the server must stop too (no orphan holding the accounts).
 */
export class DesktopChannel implements IAttentionSink {
  private readonly reader = Bun.stdin.stream().getReader();
  private buffer = '';

  public async readSecrets(): Promise<DesktopSecrets> {
    const line = await this.nextLine();

    if (line === null) {
      throw new Error('the shell closed stdin before sending the secrets');
    }

    return JSON.parse(line) as DesktopSecrets;
  }

  /** Resolves when the shell goes away. */
  public async closed(): Promise<void> {
    while ((await this.nextLine()) !== null) {
      // Later: messages from the shell (an update is ready, …).
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
