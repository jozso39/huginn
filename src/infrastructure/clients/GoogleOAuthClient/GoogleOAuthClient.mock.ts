import type {
  GoogleAccessToken,
  GoogleAuthorizationRequest,
  GoogleClientCredentials,
  GoogleGrant,
  IGoogleOAuthClient,
} from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';

export const MOCK_REFRESH_TOKEN = '1//mock-refresh-token';
export const MOCK_GOOGLE_ACCOUNT = 'jozef@example.com';

export class MockGoogleOAuthClient implements IGoogleOAuthClient {
  public authorizationUrl(request: GoogleAuthorizationRequest): string {
    return `https://accounts.example.com/auth?state=${request.state}&redirect_uri=${encodeURIComponent(request.redirectUri)}`;
  }

  public exchangeCode(
    _credentials: GoogleClientCredentials,
    code: string,
    _redirectUri: string
  ): Promise<GoogleGrant> {
    return code === 'good-code'
      ? Promise.resolve({ refreshToken: MOCK_REFRESH_TOKEN, email: MOCK_GOOGLE_ACCOUNT })
      : Promise.reject(new Error('invalid_grant'));
  }

  public accessToken(
    _credentials: GoogleClientCredentials,
    _refreshToken: string
  ): Promise<GoogleAccessToken> {
    return Promise.resolve({ token: 'mock-access', expiresAt: Date.now() + 3_600_000 });
  }
}
