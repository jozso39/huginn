import type { Logger } from '@/lib/logger';
import type { ILlmClient, JsonCompletionRequest } from '@/core/clients/LlmClient/LlmClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { IAiKeySource } from '@/core/settings/AiKey.types';
import { AiProvider } from '@/core/settings/AiKey.types';

export interface OpenRouterLlmClientConfig {
  readonly model: string;
  readonly timeoutMs: number;
}

interface ChatResponse {
  readonly choices?: readonly { readonly message?: { readonly content?: string | null } }[];
}

/**
 * Chat completions through OpenRouter with a strict JSON schema. Routed only to
 * providers that neither store nor train on the prompt: message content goes in.
 */
export class OpenRouterLlmClient implements ILlmClient {
  constructor(
    private readonly logger: Logger,
    private readonly keys: IAiKeySource,
    private readonly config: OpenRouterLlmClientConfig
  ) {}

  /** Only an OpenRouter key brings a chat model; TypeSafe offers Jev alone. */
  public available(): boolean {
    return this.keys.credentials()?.provider === AiProvider.OpenRouter;
  }

  public async completeJson(request: JsonCompletionRequest): Promise<unknown> {
    const credentials = this.keys.credentials();

    if (credentials?.provider !== AiProvider.OpenRouter) {
      throw new HuginnError(
        ErrorCode.Unsupported,
        'Learning rules from a reason needs an OpenRouter key (Settings → AI Triage)'
      );
    }

    const started = Date.now();
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
        provider: { data_collection: 'deny', zdr: true, require_parameters: true },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new HuginnError(
        ErrorCode.Upstream,
        `OpenRouter ${response.status}: ${await response.text().catch(() => '')}`
      );
    }

    const content = ((await response.json()) as ChatResponse).choices?.[0]?.message?.content;

    this.logger.debug({ ms: Date.now() - started, model: this.config.model }, 'llm');

    if (!content) {
      throw new HuginnError(ErrorCode.Upstream, 'the model returned nothing');
    }

    try {
      return JSON.parse(content) as unknown;
    } catch {
      throw new HuginnError(ErrorCode.Upstream, 'the model did not return JSON');
    }
  }
}
