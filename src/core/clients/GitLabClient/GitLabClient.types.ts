/** The subset of a GitLab todo Huginn reads. Field names follow the API. */
export interface GitLabTodo {
  readonly id: number;
  readonly action_name: string;
  readonly target_type: string;
  readonly target_url: string;
  readonly body: string;
  readonly created_at: string;
  readonly state: 'pending' | 'done';
  readonly author: { readonly name: string; readonly username: string };
  readonly project: { readonly id: number; readonly path_with_namespace: string } | null;
  readonly target: {
    readonly id: number;
    readonly iid: number;
    readonly title: string;
    readonly state?: string;
  };
}

export interface GitLabNoteRef {
  readonly id: number;
  readonly url: string;
}

export interface IGitLabClient {
  listPendingTodos(): Promise<readonly GitLabTodo[]>;
  markTodoDone(todoId: number): Promise<void>;
  /** Comments on an MR or issue; `targetType` is the todo's `target_type`. */
  createNote(
    projectId: number,
    targetType: string,
    targetIid: number,
    body: string
  ): Promise<GitLabNoteRef>;
}
