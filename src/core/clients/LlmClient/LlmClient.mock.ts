import type { ILlmClient, JsonCompletionRequest } from '@/core/clients/LlmClient/LlmClient.types';

/** Returns `next` (tests set it) and keeps every request for assertions. */
export class MockLlmClient implements ILlmClient {
  public next: unknown = {
    action: 'none',
    ruleId: null,
    name: '',
    verdict: 'Spam',
    kind: 'Hard',
    predicateJson: null,
    criterion: null,
    reasoning: 'Nothing to learn.',
  };
  public readonly requests: JsonCompletionRequest[] = [];
  public isAvailable = true;

  public available(): boolean {
    return this.isAvailable;
  }

  public completeJson(request: JsonCompletionRequest): Promise<unknown> {
    this.requests.push(request);

    return Promise.resolve(this.next);
  }
}
