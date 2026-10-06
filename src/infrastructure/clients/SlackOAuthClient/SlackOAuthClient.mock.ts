import type {
  ISlackOAuthClient,
  SlackGrant,
  SlackTokens,
} from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

export const MOCK_SLACK_CODE = 'slack-code';

/** Signs in UME of team TACME when given MOCK_SLACK_CODE; every refresh hands out a new pair. */
export class MockSlackOAuthClient implements ISlackOAuthClient {
  public exchanged: readonly { codeVerifier: string; redirectUri: string }[] = [];
  public refreshes = 0;

  public exchangeCode(request: {
    readonly clientId: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }): Promise<SlackGrant> {
    if (request.code !== MOCK_SLACK_CODE) {
      return Promise.reject(new HuginnError(ErrorCode.Unauthorized, 'Slack sign-in: invalid_code'));
    }

    this.exchanged = [
      ...this.exchanged,
      { codeVerifier: request.codeVerifier, redirectUri: request.redirectUri },
    ];

    return Promise.resolve({
      accessToken: 'xoxe.xoxp-1',
      refreshToken: 'xoxe-1-refresh',
      expiresAt: Date.now() + 12 * 3600 * 1000,
      userId: 'UME',
      teamId: 'TACME',
      teamName: 'Acme',
    });
  }

  public refresh(_request: {
    readonly clientId: string;
    readonly refreshToken: string;
  }): Promise<SlackTokens> {
    this.refreshes += 1;

    return Promise.resolve({
      accessToken: `xoxe.xoxp-${this.refreshes + 1}`,
      refreshToken: `xoxe-1-refresh-${this.refreshes}`,
      expiresAt: Date.now() + 12 * 3600 * 1000,
    });
  }
}
