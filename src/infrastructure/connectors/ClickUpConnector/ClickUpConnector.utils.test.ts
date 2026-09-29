import { describe, expect, test } from 'bun:test';
import type { ClickUpComment } from '@/core/clients/ClickUpClient/ClickUpClient.types';
import { ItemKind } from '@/core/items/Item.types';
import {
  MOCK_CLICKUP_BOSS,
  MOCK_CLICKUP_COMMENT,
  MOCK_CLICKUP_ME,
  MOCK_CLICKUP_TASK,
} from '@/infrastructure/clients/ClickUpClient/ClickUpClient.mock';
import {
  assignmentToItem,
  commentToItem,
  decideComments,
  isNewAssignment,
  mentionsUser,
} from './ClickUpConnector.utils';

const comment = (overrides: Partial<ClickUpComment>): ClickUpComment => ({
  ...MOCK_CLICKUP_COMMENT,
  comment: [{ text: 'plain' }],
  comment_text: 'plain',
  ...overrides,
});

describe('mentions', () => {
  test('a tag of the user counts, and so does a plain @username', () => {
    expect(mentionsUser(MOCK_CLICKUP_COMMENT, MOCK_CLICKUP_ME)).toBe(true);
    expect(mentionsUser(comment({ comment_text: 'ping @jozef čambora' }), MOCK_CLICKUP_ME)).toBe(
      true
    );
    expect(mentionsUser(comment({}), MOCK_CLICKUP_ME)).toBe(false);
  });
});

describe('decideComments', () => {
  test('only comments by others after `since` come in', () => {
    const old = comment({ id: 'old', date: '1000' });
    const fresh = comment({ id: 'fresh', date: '3000' });
    const decision = decideComments([fresh, old], MOCK_CLICKUP_ME, 2000);

    expect(decision.answered).toBe(false);
    expect(decision.incoming.map((c) => c.id)).toEqual(['fresh']);
  });

  test('my comment answers everything before it; later ones still come in', () => {
    const before = comment({ id: 'before', date: '3000' });
    const mine = comment({ id: 'mine', date: '4000', user: MOCK_CLICKUP_ME });
    const after = comment({ id: 'after', date: '5000' });
    const decision = decideComments([after, mine, before], MOCK_CLICKUP_ME, 2000);

    expect(decision.answered).toBe(true);
    expect(decision.incoming.map((c) => c.id)).toEqual(['after']);
  });
});

describe('items', () => {
  test('a tagging comment is a mention linking to the comment itself', () => {
    const item = commentToItem(
      'conn',
      MOCK_CLICKUP_TASK,
      MOCK_CLICKUP_COMMENT,
      MOCK_CLICKUP_ME,
      4000
    );

    expect(item.kind).toBe(ItemKind.Mention);
    expect(item.author).toBe('The Boss');
    expect(item.title).toBe('Clean up old ai-service worktrees');
    expect(item.threadKey).toBe('task:task1');
    expect(item.url).toBe('https://app.clickup.com/t/task1?comment=c1');
    expect(item.features).toMatchObject({
      isMention: true,
      listName: 'Operativa',
      priority: 'high',
    });
  });

  test('an unresolved comment assigned to me is a mention too; resolved it is not', () => {
    const assigned = comment({ assignee: MOCK_CLICKUP_ME });
    const resolved = comment({ assignee: MOCK_CLICKUP_ME, resolved: true });

    expect(commentToItem('c', MOCK_CLICKUP_TASK, assigned, MOCK_CLICKUP_ME, 4000).kind).toBe(
      ItemKind.Mention
    );
    expect(commentToItem('c', MOCK_CLICKUP_TASK, resolved, MOCK_CLICKUP_ME, 4000).kind).toBe(
      ItemKind.Comment
    );
  });

  test('a new assignment names who created the task; known or closed tasks are not new', () => {
    const item = assignmentToItem('conn', MOCK_CLICKUP_TASK, 4000);
    const closed = { ...MOCK_CLICKUP_TASK, status: { status: 'done', type: 'closed' } };

    expect(item.kind).toBe(ItemKind.Assignment);
    expect(item.author).toBe(MOCK_CLICKUP_BOSS.username);
    expect(item.body).toBe('The -wt-cluster and -wt-limit ones.');
    expect(isNewAssignment(MOCK_CLICKUP_TASK, new Set(), MOCK_CLICKUP_ME)).toBe(true);
    expect(isNewAssignment(MOCK_CLICKUP_TASK, new Set(['task1']), MOCK_CLICKUP_ME)).toBe(false);
    expect(isNewAssignment(closed, new Set(), MOCK_CLICKUP_ME)).toBe(false);
    // A task I created and assigned to myself is not news.
    expect(
      isNewAssignment(
        { ...MOCK_CLICKUP_TASK, creator: MOCK_CLICKUP_ME },
        new Set(),
        MOCK_CLICKUP_ME
      )
    ).toBe(false);
  });
});
