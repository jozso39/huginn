import type { RuleDraft } from '@/core/triage/Rule.types';
import { ConditionOp, RuleKind, RuleVerdict } from '@/core/triage/Rule.types';

// Origin triage: what each connector knows up front. Everything no rule catches
// starts Undecided and gets sorted by the user's Spam / Important feedback.

const isTrue = (field: string) => ({ field, op: ConditionOp.IsTrue });

const important = (name: string, predicate: RuleDraft['predicate']): RuleDraft => ({
  name,
  verdict: RuleVerdict.Important,
  kind: RuleKind.Hard,
  predicate,
});

export const SLACK_DEFAULT_RULES: readonly RuleDraft[] = [
  important('Direct message', isTrue('isDm')),
  important('Mentions me', isTrue('isPersonalMention')),
  important('Mentions a group I am in', isTrue('isMention')),
  important('Reply in a thread I wrote in', isTrue('inMyThread')),
];

export const GMAIL_DEFAULT_RULES: readonly RuleDraft[] = [
  {
    name: 'Promotions and Social tabs',
    verdict: RuleVerdict.Spam,
    kind: RuleKind.Hard,
    predicate: { field: 'category', op: ConditionOp.In, value: ['PROMOTIONS', 'SOCIAL'] },
  },
  important('From a colleague, to me', {
    all: [isTrue('sameDomain'), isTrue('toMe'), { field: 'isBulk', op: ConditionOp.IsFalse }],
  }),
  {
    name: 'Mailing lists and bulk mail',
    verdict: RuleVerdict.Spam,
    kind: RuleKind.Hard,
    predicate: isTrue('isBulk'),
  },
  {
    // Before the "asks me" rule on purpose: a tool's notification that says "please
    // review" is covered by that tool's own connection.
    name: 'Automated notification',
    verdict: RuleVerdict.Spam,
    kind: RuleKind.Soft,
    criterion:
      'This email is an automated notification, receipt, digest or newsletter sent by a system, not written to me by a person.',
    threshold: 0.8,
  },
  {
    name: 'Asks me for something',
    verdict: RuleVerdict.Important,
    kind: RuleKind.Soft,
    criterion:
      'This email asks me personally to do something, answer a question, or make a decision.',
    threshold: 0.75,
  },
];

export const GITLAB_DEFAULT_RULES: readonly RuleDraft[] = [
  important('Review requested', isTrue('isReviewRequest')),
  important('Mentions me', isTrue('isMention')),
  important('Assigned to me', isTrue('isAssignment')),
  important('Pipeline failed', { field: 'action', op: ConditionOp.Equals, value: 'build_failed' }),
];

export const CLICKUP_DEFAULT_RULES: readonly RuleDraft[] = [
  important('Mentions me or assigns me a comment', {
    any: [isTrue('isMention'), isTrue('isAssignedComment')],
  }),
  important('Newly assigned task', isTrue('isNewAssignment')),
  {
    name: 'Comment asks me for something',
    verdict: RuleVerdict.Important,
    kind: RuleKind.Soft,
    criterion: 'This comment asks me to do something, answer a question, or make a decision.',
    threshold: 0.75,
  },
];

export const LINKEDIN_DEFAULT_RULES: readonly RuleDraft[] = [
  important('Message', isTrue('isMessage')),
  important('Mentions me', isTrue('isMention')),
  {
    name: 'Jobs and feed updates',
    verdict: RuleVerdict.Spam,
    kind: RuleKind.Hard,
    predicate: { field: 'notice', op: ConditionOp.In, value: ['Job', 'Update'] },
  },
];

// Condition rules only: no Signal text goes to a model unless you add a sentence rule.
export const SIGNAL_DEFAULT_RULES: readonly RuleDraft[] = [
  important('Direct message', isTrue('isDm')),
  important('Mentions me in a group', isTrue('isMention')),
];
