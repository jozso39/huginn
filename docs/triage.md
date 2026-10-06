# Triage

Every new item lands in **Important**, **Undecided** or **Spam**. The inbox shows
Important and Undecided; Spam has its own tab. Each item says *why* it is where it is.

## Rules

Each connection has its own rules (**Settings → Rules** on the connection). They are tried top to
bottom and **the first one that fires decides**; if none fires, the item is Undecided.
Every decision names its rule, and every rule counts its hits.

- **Condition rules** check the item's fields — sender domain, "is a DM", Gmail tab,
  ClickUp list… The rule editor lists the fields each connection has, with sample
  values. Free and instant.
- **Sentence rules** are one yes/no statement ("This email is an automated notification
  that needs no reply"), judged by [Jev](https://typesafe.ai), a small calibrated
  classifier, through OpenRouter. All of a connection's sentence rules are asked in one
  call (~0.5 s, ~$0.00002), and only when an item gets that far down the list. A rule
  fires at or above its threshold (default 0.7).

**Test on recent items** in the editor shows where a rule would fire before you save it,
and warns when it disagrees with something you sorted by hand. Changing rules re-sorts
the waiting items; items you sorted yourself are never moved by a rule.

New connections start with built-in rules for what the connector knows (a Slack DM, a
GitLab review request, a ClickUp mention, Gmail's Promotions tab…). Edit or delete them
freely.

## Teaching it: Spam / Important

Every item has **Spam** and **Important** buttons (`s` / `i`). The item moves at once.
If you also say *why*, an agent (Claude Haiku via OpenRouter, zero-retention providers
only) turns that into the smallest sensible rule change — a new rule, or a narrower
version of the rule that got it wrong. You get one line saying what changed.

Messages are written by strangers, so the agent is fenced in:

1. **Before**: Jev is asked whether the message tries to instruct an AI. If it probably
   does, the agent only sees the metadata; if it clearly does, no rule is learned.
2. **The answer** is a strict JSON rule, validated like any rule you type, limited to
   this connection, and a new rule must use the verdict you chose.
3. **After**: the change goes live only if it would actually have moved this message,
   does not contradict anything you sorted by hand, is not a spam rule catching most
   of your recent items, and Jev agrees it follows from your explanation rather than
   from the message. Otherwise it waits under **Waiting for your approval**.

Every change is in the rule history with your explanation and the checks it passed.

## Configuration

`HUGINN_OPENROUTER_API_KEY` enables sentence rules, the guardrails and the agent.
Without it, condition rules still work and Spam / Important still move items.
`HUGINN_JEV_MODEL` (default `typesafe/jev-1.13`) and `HUGINN_FEEDBACK_MODEL` (default
`anthropic/claude-haiku-4.5`) pick the models.
