import type { AiCredentials, IAiKeyChecker } from '@/core/settings/AiKey.types';
import { AiProvider } from '@/core/settings/AiKey.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';

// One cheap, free call each: OpenRouter describes the key, TypeSafe lists its models.
const CHECK_URL: Readonly<Record<AiProvider, string>> = {
  [AiProvider.OpenRouter]: 'https://openrouter.ai/api/v1/key',
  [AiProvider.TypeSafe]: 'https://api.typesafe.ai/v1/models',
};

/** Asks the provider whether a key works before Huginn keeps it. */
export class AiKeyChecker implements IAiKeyChecker {
  constructor(private readonly timeoutMs: number) {}

  public async check({ provider, apiKey }: AiCredentials): Promise<void> {
    const response = await fetch(CHECK_URL[provider], {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      throw new HuginnError(
        ErrorCode.Upstream,
        `Could not reach ${provider} to check the key: ${toError(error).message}`
      );
    });

    if (response.status === 401 || response.status === 403) {
      throw new HuginnError(ErrorCode.Validation, `${provider} does not accept this key`);
    }

    if (!response.ok) {
      throw new HuginnError(
        ErrorCode.Upstream,
        `${provider} answered ${response.status} when checking the key; try again`
      );
    }
  }
}
