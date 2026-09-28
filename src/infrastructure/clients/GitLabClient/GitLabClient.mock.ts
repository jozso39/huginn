import type {
  GitLabNoteRef,
  GitLabTodo,
  IGitLabClient,
} from '@/core/clients/GitLabClient/GitLabClient.types';

export const MOCK_TODO: GitLabTodo = {
  id: 101,
  action_name: 'review_requested',
  target_type: 'MergeRequest',
  target_url: 'https://gitlab.example.com/medevio/api/-/merge_requests/42',
  body: 'Please have a look at the retry logic.',
  created_at: '2026-09-28T08:00:00.000Z',
  state: 'pending',
  author: { name: 'Alice Reviewer', username: 'alice' },
  project: { id: 7, path_with_namespace: 'medevio/api' },
  target: { id: 4242, iid: 42, title: 'Retry failed webhooks', state: 'opened' },
};

export class MockGitLabClient implements IGitLabClient {
  public listPendingTodos(): Promise<readonly GitLabTodo[]> {
    return Promise.resolve([MOCK_TODO]);
  }

  public markTodoDone(_todoId: number): Promise<void> {
    return Promise.resolve();
  }

  public createNote(
    _projectId: number,
    _targetType: string,
    _targetIid: number,
    _body: string
  ): Promise<GitLabNoteRef> {
    return Promise.resolve({ id: 9001, url: 'https://gitlab.example.com/note/9001' });
  }
}
