import type { AiCredentials, IAiKeyChecker } from '@/core/settings/AiKey.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

/** Accepts every key except ones containing "refused", as the provider would refuse them. */
export class MockAiKeyChecker implements IAiKeyChecker {
  public checked: readonly AiCredentials[] = [];

  public check(credentials: AiCredentials): Promise<void> {
    this.checked = [...this.checked, credentials];

    return credentials.apiKey.includes('refused')
      ? Promise.reject(
          new HuginnError(ErrorCode.Validation, `${credentials.provider} does not accept this key`)
        )
      : Promise.resolve();
  }
}
