import type {
  ClickUpComment,
  ClickUpTask,
  ClickUpUser,
  ClickUpWorkspace,
  IClickUpClient,
} from '@/core/clients/ClickUpClient/ClickUpClient.types';

export const MOCK_CLICKUP_ME: ClickUpUser = { id: 1, username: 'Jozef Čambora' };
export const MOCK_CLICKUP_BOSS: ClickUpUser = { id: 2, username: 'The Boss' };

const hoursAgo = (hours: number) => String(Date.now() - hours * 3_600_000);

export const MOCK_CLICKUP_TASK: ClickUpTask = {
  id: 'task1',
  name: 'Clean up old ai-service worktrees',
  text_content: 'The -wt-cluster and -wt-limit ones.',
  status: { status: 'to do', type: 'open' },
  assignees: [MOCK_CLICKUP_ME],
  creator: MOCK_CLICKUP_BOSS,
  url: 'https://app.clickup.com/t/task1',
  list: { id: 'l1', name: 'Operativa' },
  priority: { priority: 'high' },
  date_created: hoursAgo(30),
  date_updated: hoursAgo(1),
};

/** A comment that tags the user, from an hour ago. */
export const MOCK_CLICKUP_COMMENT: ClickUpComment = {
  id: 'c1',
  comment: [
    { text: 'Hey ' },
    { type: 'tag', user: { id: MOCK_CLICKUP_ME.id } },
    { text: ' can you do this today?' },
  ],
  comment_text: 'Hey @Jozef Čambora can you do this today?',
  user: MOCK_CLICKUP_BOSS,
  date: hoursAgo(1),
  reply_count: '0',
};

/**
 * One assigned task with one tagging comment. Tests reshape `tasks`, `openTaskIds`
 * and `comments` between polls to play out what happens in ClickUp.
 */
export class MockClickUpClient implements IClickUpClient {
  public tasks: ClickUpTask[] = [MOCK_CLICKUP_TASK];
  public openTaskIds: string[] = [];
  public comments = new Map<string, ClickUpComment[]>([['task1', [MOCK_CLICKUP_COMMENT]]]);
  public remaining: number | null = 99;
  public readonly posted: { taskId?: string; commentId?: string; text: string }[] = [];

  public me(): Promise<ClickUpUser> {
    return Promise.resolve(MOCK_CLICKUP_ME);
  }

  public workspaces(): Promise<readonly ClickUpWorkspace[]> {
    return Promise.resolve([{ id: 'w1', name: 'Medevio' }]);
  }

  public myTasksUpdatedSince(
    _workspaceId: string,
    _userId: number,
    since: number
  ): Promise<readonly ClickUpTask[]> {
    return Promise.resolve(this.tasks.filter((task) => Number(task.date_updated) > since));
  }

  public myOpenTaskIds(_workspaceId: string, _userId: number): Promise<readonly string[]> {
    return Promise.resolve(this.openTaskIds);
  }

  public taskComments(taskId: string): Promise<readonly ClickUpComment[]> {
    return Promise.resolve(this.comments.get(taskId) ?? []);
  }

  public commentOnTask(taskId: string, text: string): Promise<{ readonly id: string }> {
    this.posted.push({ taskId, text });

    return Promise.resolve({ id: 'new-comment' });
  }

  public replyToComment(commentId: string, text: string): Promise<{ readonly id: string }> {
    this.posted.push({ commentId, text });

    return Promise.resolve({ id: 'new-reply' });
  }

  public rateLimitRemaining(): number | null {
    return this.remaining;
  }
}
