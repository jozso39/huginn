import type { Logger } from '@/lib/logger';
import type {
  GitLabNoteRef,
  GitLabTodo,
  IGitLabClient,
} from '@/core/clients/GitLabClient/GitLabClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

export interface GitLabClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
}

export class GitLabClient implements IGitLabClient {
  constructor(
    private readonly logger: Logger,
    private readonly config: GitLabClientConfig
  ) {}

  public async listPendingTodos(): Promise<readonly GitLabTodo[]> {
    // 100 is the API maximum per page; a second page means more than a hundred
    // pending todos, at which point the dashboard is the least of the problems.
    return this.request<GitLabTodo[]>('GET', '/todos?state=pending&per_page=100');
  }

  public async markTodoDone(todoId: number): Promise<void> {
    await this.request('POST', `/todos/${todoId}/mark_as_done`);
  }

  public async createNote(
    projectId: number,
    targetType: string,
    targetIid: number,
    body: string
  ): Promise<GitLabNoteRef> {
    const resource = GitLabClient.resourceFor(targetType);
    const note = await this.request<{ id: number }>(
      'POST',
      `/projects/${projectId}/${resource}/${targetIid}/notes`,
      { body }
    );

    return { id: note.id, url: `${this.webUrl(projectId)}#note_${note.id}` };
  }

  private static resourceFor(targetType: string): string {
    switch (targetType) {
      case 'MergeRequest':
        return 'merge_requests';
      case 'Issue':
        return 'issues';
      case 'Epic':
        return 'epics';
      default:
        throw new HuginnError(ErrorCode.Unsupported, `cannot comment on ${targetType}`);
    }
  }

  private webUrl(projectId: number): string {
    return `${this.config.baseUrl}/projects/${projectId}`;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.config.token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');

      this.logger.warn({ method, path, status: response.status }, 'gitlab request failed');
      throw new HuginnError(
        ErrorCode.Upstream,
        `GitLab ${response.status} on ${method} ${path}`,
        text
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
