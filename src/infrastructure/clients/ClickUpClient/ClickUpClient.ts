import type { Logger } from '@/lib/logger';
import type {
  ClickUpComment,
  ClickUpTask,
  ClickUpUser,
  ClickUpWorkspace,
  IClickUpClient,
} from '@/core/clients/ClickUpClient/ClickUpClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

const API = 'https://api.clickup.com/api/v2';

/** Safety stop for pagination; a hundred pages of assigned tasks is not a real account. */
const MAX_PAGES = 20;

export interface ClickUpClientConfig {
  readonly token: string;
  readonly timeoutMs: number;
}

export class ClickUpClient implements IClickUpClient {
  private remaining: number | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly config: ClickUpClientConfig
  ) {}

  public async me(): Promise<ClickUpUser> {
    return (await this.request<{ user: ClickUpUser }>('GET', '/user')).user;
  }

  public async workspaces(): Promise<readonly ClickUpWorkspace[]> {
    return (await this.request<{ teams: ClickUpWorkspace[] }>('GET', '/team')).teams;
  }

  public async myTasksUpdatedSince(
    workspaceId: string,
    userId: number,
    since: number
  ): Promise<readonly ClickUpTask[]> {
    const params = new URLSearchParams({
      subtasks: 'true',
      // Closed tasks still get comments that matter ("why was this closed?").
      include_closed: 'true',
      date_updated_gt: String(since),
      order_by: 'updated',
      page: '0',
    });

    params.append('assignees[]', String(userId));

    const page = await this.request<{ tasks: ClickUpTask[] }>(
      'GET',
      `/team/${workspaceId}/task?${params.toString()}`
    );

    return page.tasks;
  }

  public async myOpenTaskIds(workspaceId: string, userId: number): Promise<readonly string[]> {
    const fetchPage = async (page: number, ids: readonly string[]): Promise<readonly string[]> => {
      const params = new URLSearchParams({ subtasks: 'true', page: String(page) });

      params.append('assignees[]', String(userId));

      const result = await this.request<{ tasks: ClickUpTask[]; last_page?: boolean }>(
        'GET',
        `/team/${workspaceId}/task?${params.toString()}`
      );
      const all = [...ids, ...result.tasks.map((task) => task.id)];
      // Pages hold 100; a short page or last_page is the end.
      const done = result.last_page === true || result.tasks.length < 100 || page + 1 >= MAX_PAGES;

      return done ? all : fetchPage(page + 1, all);
    };

    return fetchPage(0, []);
  }

  public async taskComments(taskId: string): Promise<readonly ClickUpComment[]> {
    return (await this.request<{ comments: ClickUpComment[] }>('GET', `/task/${taskId}/comment`))
      .comments;
  }

  public commentOnTask(taskId: string, text: string): Promise<{ readonly id: string }> {
    return this.request<{ id: string }>('POST', `/task/${taskId}/comment`, {
      comment_text: text,
      notify_all: false,
    });
  }

  public async replyToComment(commentId: string, text: string): Promise<{ readonly id: string }> {
    const reply = await this.request<{ id?: string }>('POST', `/comment/${commentId}/reply`, {
      comment_text: text,
    });

    return { id: reply.id ?? commentId };
  }

  public rateLimitRemaining(): number | null {
    return this.remaining;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        // Personal tokens go in as-is, without "Bearer".
        Authorization: this.config.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));

    if (Number.isFinite(remaining) && response.headers.has('x-ratelimit-remaining')) {
      this.remaining = remaining;
    }

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { err?: string; ECODE?: string };
      const code =
        response.status === 401
          ? ErrorCode.Unauthorized
          : response.status === 404
            ? ErrorCode.NotFound
            : ErrorCode.Upstream;

      this.logger.warn(
        { method, path: path.split('?')[0], status: response.status },
        'clickup failed'
      );
      throw new HuginnError(
        code,
        `ClickUp ${response.status}: ${detail.err ?? response.statusText}${detail.ECODE ? ` (${detail.ECODE})` : ''}`
      );
    }

    return (await response.json()) as T;
  }
}
