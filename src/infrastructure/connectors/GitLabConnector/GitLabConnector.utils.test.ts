import { describe, expect, test } from 'bun:test';
import { ItemKind, StatusTone } from '@/core/items/Item.types';
import { MOCK_TODO } from '@/infrastructure/clients/GitLabClient/GitLabClient.mock';
import { todoExternalId, todoToItem } from './GitLabConnector.utils';

describe('todoToItem', () => {
  test('maps a review request onto one item keyed by the merge request', () => {
    const item = todoToItem('conn-1', MOCK_TODO, 4000);

    expect(item.externalId).toBe('todo:101');
    expect(item.threadKey).toBe('medevio/api#MergeRequest/42');
    expect(item.kind).toBe(ItemKind.ReviewRequest);
    expect(item.title).toBe('medevio/api!42 Retry failed webhooks');
    expect(item.url).toBe(MOCK_TODO.target_url);
    expect(item.features.isReviewRequest).toBe(true);
    expect(item.features.isMention).toBe(false);
  });

  test('classifies mentions, assignments and failed builds', () => {
    const mention = todoToItem('c', { ...MOCK_TODO, action_name: 'directly_addressed' }, 4000);
    const assigned = todoToItem('c', { ...MOCK_TODO, action_name: 'assigned' }, 4000);
    const build = todoToItem('c', { ...MOCK_TODO, action_name: 'build_failed' }, 4000);

    expect(mention.kind).toBe(ItemKind.Mention);
    expect(assigned.kind).toBe(ItemKind.Assignment);
    expect(build.kind).toBe(ItemKind.Alert);
  });

  test('a merge request carries its state as GitLab names and colours it', () => {
    const at = (state: string) => ({ ...MOCK_TODO, target: { ...MOCK_TODO.target, state } });

    expect(todoToItem('c', MOCK_TODO, 4000).status).toEqual({
      label: 'Open',
      tone: StatusTone.Success,
    });
    expect(todoToItem('c', at('merged'), 4000).status?.tone).toBe(StatusTone.Info);
    expect(todoToItem('c', at('closed'), 4000).status?.label).toBe('Closed');
    // Issues and unknown states get no pill rather than a wrong one.
    expect(todoToItem('c', { ...MOCK_TODO, target_type: 'Issue' }, 4000).status).toBeNull();
    expect(todoToItem('c', at('something_new'), 4000).status).toBeNull();
  });

  test('caps the body and survives a missing project', () => {
    const item = todoToItem('c', { ...MOCK_TODO, project: null, body: 'x'.repeat(50) }, 10);

    expect(item.body).toHaveLength(10);
    expect(item.threadKey).toBe('unknown#MergeRequest/42');
    expect(todoExternalId(MOCK_TODO)).toBe('todo:101');
  });
});
