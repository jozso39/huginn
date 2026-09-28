import { z } from 'zod';
import type { Item } from '@/core/items/Item.types';
import type { Condition, Predicate } from './Rule.types';
import { ConditionOp } from './Rule.types';

const conditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(ConditionOp),
  value: z
    .union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)])
    .optional(),
});

/** Validates any predicate that comes from outside (user, agent, database). */
export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({ all: z.array(predicateSchema).min(1).max(20) }),
    z.object({ any: z.array(predicateSchema).min(1).max(20) }),
    z.object({ not: predicateSchema }),
  ])
);

/** Item fields rules can see besides the connector's features. */
const ITEM_FIELDS = ['author', 'title', 'body', 'kind'] as const;

type FieldValue = string | number | boolean | null | undefined;

const fieldValue = (
  item: Pick<Item, 'author' | 'title' | 'body' | 'kind' | 'features'>,
  field: string
): FieldValue =>
  (ITEM_FIELDS as readonly string[]).includes(field)
    ? item[field as (typeof ITEM_FIELDS)[number]]
    : item.features[field];

const lower = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).toLowerCase()
    : '';

/** A regex from outside must not hang the process; anything odd simply does not match. */
const safeMatch = (pattern: string, text: string): boolean => {
  if (pattern.length > 200) {
    return false;
  }

  try {
    return new RegExp(pattern, 'i').test(text.slice(0, 10_000));
  } catch {
    return false;
  }
};

const evaluateCondition = (condition: Condition, value: FieldValue): boolean => {
  const expected = condition.value;

  switch (condition.op) {
    case ConditionOp.Exists:
      return value !== null && value !== undefined && value !== '';
    case ConditionOp.IsTrue:
      return value === true;
    case ConditionOp.IsFalse:
      return value === false;
    case ConditionOp.Equals:
      return lower(value) === lower(expected);
    case ConditionOp.NotEquals:
      return lower(value) !== lower(expected);
    case ConditionOp.Contains:
      return lower(value).includes(lower(expected));
    case ConditionOp.NotContains:
      return !lower(value).includes(lower(expected));
    case ConditionOp.StartsWith:
      return lower(value).startsWith(lower(expected));
    case ConditionOp.EndsWith:
      return lower(value).endsWith(lower(expected));
    case ConditionOp.Matches:
      return typeof expected === 'string' && safeMatch(expected, String(value ?? ''));
    case ConditionOp.In:
      return Array.isArray(expected) && expected.map(lower).includes(lower(value));
    case ConditionOp.GreaterThan:
      return Number(value) > Number(expected);
    case ConditionOp.LessThan:
      return Number(value) < Number(expected);
    default:
      return false;
  }
};

export const evaluatePredicate = (
  predicate: Predicate,
  item: Pick<Item, 'author' | 'title' | 'body' | 'kind' | 'features'>
): boolean => {
  if ('all' in predicate) {
    return predicate.all.every((part) => evaluatePredicate(part, item));
  }

  if ('any' in predicate) {
    return predicate.any.some((part) => evaluatePredicate(part, item));
  }

  if ('not' in predicate) {
    return !evaluatePredicate(predicate.not, item);
  }

  return evaluateCondition(predicate, fieldValue(item, predicate.field));
};

/** A short human reading of a predicate for lists and history. */
export const describePredicate = (predicate: Predicate): string => {
  if ('all' in predicate) {
    return predicate.all.map(describePredicate).join(' and ');
  }

  if ('any' in predicate) {
    return `(${predicate.any.map(describePredicate).join(' or ')})`;
  }

  if ('not' in predicate) {
    return `not ${describePredicate(predicate.not)}`;
  }

  const value = Array.isArray(predicate.value) ? predicate.value.join(', ') : predicate.value;

  return value === undefined
    ? `${predicate.field} ${predicate.op}`
    : `${predicate.field} ${predicate.op} ${String(value)}`;
};
