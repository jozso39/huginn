import type { Logger } from '@/lib/logger';
import type { IJevClient } from '@/core/clients/JevClient/JevClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

export interface JevClientConfig {
  readonly apiKey: string | null;
  /** e.g. typesafe/jev-1.13 — pinned, so a model update never silently changes triage. */
  readonly model: string;
  readonly timeoutMs: number;
}

interface SystemOneResponse {
  readonly answers?: Readonly<Record<string, { readonly type: string; readonly noul?: number }>>;
}

/**
 * Jev through OpenRouter's System One endpoint (same wire format as TypeSafe's own
 * API). Typed yes/no answers only: it cannot be talked into free text, which is
 * why it is safe to point at untrusted message content.
 */
export class JevClient implements IJevClient {
  constructor(
    private readonly logger: Logger,
    private readonly config: JevClientConfig
  ) {}

  public available(): boolean {
    return this.config.apiKey !== null;
  }

  public async nouls(
    state: Readonly<Record<string, unknown>>,
    questions: Readonly<Record<string, string>>
  ): Promise<Readonly<Record<string, number>>> {
    if (!this.config.apiKey) {
      throw new HuginnError(ErrorCode.Unsupported, 'Jev needs HUGINN_OPENROUTER_API_KEY');
    }

    const started = Date.now();
    const response = await fetch('https://openrouter.ai/api/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        state,
        questions: Object.fromEntries(
          Object.entries(questions).map(([key, instructions]) => [
            key,
            { type: 'noul', instructions },
          ])
        ),
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new HuginnError(
        ErrorCode.Upstream,
        `Jev ${response.status}: ${await response.text().catch(() => '')}`
      );
    }

    const body = (await response.json()) as SystemOneResponse;

    // Message content never goes to the log; the timing and question count do.
    this.logger.debug(
      { ms: Date.now() - started, questions: Object.keys(questions).length },
      'jev'
    );

    return Object.fromEntries(
      Object.keys(questions).map((key) => [key, body.answers?.[key]?.noul ?? 0])
    );
  }
}
