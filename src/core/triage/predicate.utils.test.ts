import { describe, expect, test } from 'bun:test';
import { ItemKind } from '@/core/items/Item.types';
import { describePredicate, evaluatePredicate, predicateSchema } from './predicate.utils';
import { ConditionOp } from './Rule.types';

const item = {
  author: 'GitLab',
  title: 'Pipeline #42 failed',
  body: 'The job lint failed.',
  kind: ItemKind.Email,
  features: { fromDomain: 'gitlab.medevio.dev', isBulk: true, recipients: 3, category: 'UPDATES' },
};

describe('evaluatePredicate', () => {
  test('conditions on features and item fields, case-insensitive', () => {
    expect(
      evaluatePredicate(
        { field: 'fromDomain', op: ConditionOp.EndsWith, value: 'MEDEVIO.dev' },
        item
      )
    ).toBe(true);
    expect(
      evaluatePredicate({ field: 'title', op: ConditionOp.Contains, value: 'failed' }, item)
    ).toBe(true);
    expect(evaluatePredicate({ field: 'isBulk', op: ConditionOp.IsTrue }, item)).toBe(true);
    expect(
      evaluatePredicate({ field: 'recipients', op: ConditionOp.GreaterThan, value: 2 }, item)
    ).toBe(true);
    expect(
      evaluatePredicate(
        { field: 'category', op: ConditionOp.In, value: ['PROMOTIONS', 'updates'] },
        item
      )
    ).toBe(true);
    expect(evaluatePredicate({ field: 'missing', op: ConditionOp.Exists }, item)).toBe(false);
  });

  test('all / any / not combine', () => {
    const predicate = {
      all: [
        { field: 'isBulk', op: ConditionOp.IsTrue },
        { not: { field: 'title', op: ConditionOp.Contains, value: 'invoice' } },
        {
          any: [
            { field: 'author', op: ConditionOp.Equals, value: 'nobody' },
            { field: 'kind', op: ConditionOp.Equals, value: 'Email' },
          ],
        },
      ],
    };

    expect(evaluatePredicate(predicate, item)).toBe(true);
    expect(describePredicate(predicate)).toBe(
      'isBulk IsTrue and not title Contains invoice and (author Equals nobody or kind Equals Email)'
    );
  });

  test('a broken or oversized regex never matches instead of throwing', () => {
    expect(evaluatePredicate({ field: 'title', op: ConditionOp.Matches, value: '(' }, item)).toBe(
      false
    );
    expect(
      evaluatePredicate({ field: 'title', op: ConditionOp.Matches, value: 'a'.repeat(300) }, item)
    ).toBe(false);
    expect(
      evaluatePredicate({ field: 'title', op: ConditionOp.Matches, value: '^pipeline #\\d+' }, item)
    ).toBe(true);
  });

  test('the schema rejects unknown ops and empty groups', () => {
    expect(predicateSchema.safeParse({ field: 'x', op: 'Explode' }).success).toBe(false);
    expect(predicateSchema.safeParse({ all: [] }).success).toBe(false);
    expect(predicateSchema.safeParse({ not: { field: 'x', op: 'IsTrue' } }).success).toBe(true);
  });
});
