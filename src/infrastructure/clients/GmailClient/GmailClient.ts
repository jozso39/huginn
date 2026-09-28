import type { Logger } from '@/lib/logger';
import type {
  GmailHistory,
  GmailHistoryRecord,
  GmailMessage,
  GmailMessageRef,
  GmailProfile,
  IGmailClient,
} from '@/core/clients/GmailClient/GmailClient.types';
import type {
  GoogleAccessToken,
  GoogleClientCredentials,
  IGoogleOAuthClient,
} from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailClientConfig {
  readonly credentials: GoogleClientCredentials;
  readonly refreshToken: string;
  readonly timeoutMs: number;
}

interface HistoryPage {
  readonly history?: readonly GmailHistoryRecord[];
  readonly historyId: string;
  readonly nextPageToken?: string;
}

export class GmailClient implements IGmailClient {
  private accessToken: GoogleAccessToken | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly oauth: IGoogleOAuthClient,
    private readonly config: GmailClientConfig
  ) {}

  public profile(): Promise<GmailProfile> {
    return this.request<GmailProfile>('GET', '/profile');
  }

  public async searchMessageIds(query: string, max: number): Promise<readonly string[]> {
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    const page = await this.request<{ messages?: readonly { id: string }[] }>(
      'GET',
      `/messages?${params.toString()}`
    );

    return (page.messages ?? []).map((message) => message.id);
  }

  public getMessage(id: string): Promise<GmailMessage> {
    return this.request<GmailMessage>('GET', `/messages/${id}?format=full`);
  }

  public async history(startHistoryId: string): Promise<GmailHistory | null> {
    const fetchPage = async (
      pageToken: string | undefined,
      records: readonly GmailHistoryRecord[]
    ): Promise<GmailHistory> => {
      const params = new URLSearchParams({ startHistoryId });

      ['messageAdded', 'labelAdded', 'labelRemoved'].forEach((type) =>
        params.append('historyTypes', type)
      );

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const page = await this.request<HistoryPage>('GET', `/history?${params.toString()}`);
      const all = [...records, ...(page.history ?? [])];

      return page.nextPageToken
        ? fetchPage(page.nextPageToken, all)
        : { records: all, historyId: page.historyId };
    };

    try {
      return await fetchPage(undefined, []);
    } catch (error) {
      // Gmail keeps about a week of history; an older cursor is a 404, not a failure.
      if (error instanceof HuginnError && error.code === ErrorCode.NotFound) {
        return null;
      }

      throw error;
    }
  }

  public send(raw: string, threadId: string): Promise<GmailMessageRef> {
    return this.request<GmailMessageRef>('POST', '/messages/send', { raw, threadId });
  }

  public createDraft(raw: string, threadId: string): Promise<{ readonly id: string }> {
    return this.request<{ id: string }>('POST', '/drafts', { message: { raw, threadId } });
  }

  public async markRead(id: string): Promise<void> {
    await this.request('POST', `/messages/${id}/modify`, { removeLabelIds: ['UNREAD'] });
  }

  private async token(): Promise<string> {
    // A minute of slack so a token never expires between the check and the call.
    if (!this.accessToken || this.accessToken.expiresAt - 60_000 < Date.now()) {
      this.accessToken = await this.oauth.accessToken(
        this.config.credentials,
        this.config.refreshToken
      );
    }

    return this.accessToken.token;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const code =
        response.status === 404
          ? ErrorCode.NotFound
          : response.status === 401 || response.status === 403
            ? ErrorCode.Unauthorized
            : ErrorCode.Upstream;

      this.logger.warn(
        { method, path: path.split('?')[0], status: response.status },
        'gmail failed'
      );
      throw new HuginnError(
        code,
        `Gmail ${response.status}: ${detail.error?.message ?? response.statusText}`
      );
    }

    return (await response.json()) as T;
  }
}
