import type { Logger } from '@/lib/logger';
import type { IJevClient } from '@/core/clients/JevClient/JevClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { IAiKeySource } from '@/core/settings/AiKey.types';
import { AiProvider } from '@/core/settings/AiKey.types';

export interface JevClientConfig {
  /** Pinned per provider, so a model update never silently changes triage. */
  readonly models: Readonly<Record<AiProvider, string>>;
  readonly timeoutMs: number;
}

// Both speak the same System One format; only the address and the model's name differ.
const ENDPOINTS: Readonly<Record<AiProvider, string>> = {
  [AiProvider.OpenRouter]: 'https://openrouter.ai/api/v1/systemone',
  [AiProvider.TypeSafe]: 'https://api.typesafe.ai/v1/systemone',
};

interface SystemOneResponse {
  readonly answers?: Readonly<Record<string, { readonly type: string; readonly noul?: number }>>;
}

/**
 * Jev through whichever key is set: OpenRouter's System One endpoint or TypeSafe's own.
 * Typed yes/no answers only: it cannot be talked into free text, which is why it is
 * safe to point at untrusted message content.
 */
export class JevClient implements IJevClient {
  constructor(
    private readonly logger: Logger,
    private readonly keys: IAiKeySource,
    private readonly config: JevClientConfig
  ) {}

  public available(): boolean {
    return this.keys.credentials() !== null;
  }

  public async nouls(
    state: Readonly<Record<string, unknown>>,
    questions: Readonly<Record<string, string>>
  ): Promise<Readonly<Record<string, number>>> {
    const credentials = this.keys.credentials();

    if (!credentials) {
      throw new HuginnError(
        ErrorCode.Unsupported,
        'Sentence rules need an AI key (Settings → Triage)'
      );
    }

    const started = Date.now();
    const response = await fetch(ENDPOINTS[credentials.provider], {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.models[credentials.provider],
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
      {
        ms: Date.now() - started,
        provider: credentials.provider,
        questions: Object.keys(questions).length,
      },
      'jev'
    );

    return Object.fromEntries(
      Object.keys(questions).map((key) => [key, body.answers?.[key]?.noul ?? 0])
    );
  }
}
