# Connecting ClickUp

**Settings → Add connection → ClickUp**, paste your personal API token
(ClickUp → avatar → *Settings* → *Apps* → *API Token*, starts with `pk_`). If the token
sees more than one workspace, the connection says so and lists their IDs — put the one
you want under *Workspace ID* with **Edit**.

## What comes in

ClickUp has no API for its inbox or notifications (requested since 2022, "not on the
roadmap" in 2025), so Huginn watches **the tasks assigned to you**:

| In ClickUp | In Huginn |
|---|---|
| A task is newly assigned to you | an *assigned* item |
| Someone comments on one of your tasks | a *comment* item |
| …and tags you, or assigns the comment to you | a *mention* item |
| You comment on the task (in ClickUp or from Huginn) | the task's items close |

**Nothing you wrote ever comes in** — your own comments, and tasks you created (even
when assigned to yourself). This is built into the connector, not a triage rule.

**Reply** answers in the comment's thread (or, for an assignment, as a task comment).
There is no *Done* at ClickUp's side — no API for it — so Done only clears it here.

The first sync remembers every task already assigned to you (so your backlog does not
flood the inbox) and brings in comments from the last 3 days.

## Rate limit

ClickUp allows 100 requests a minute per token. Huginn checks once a minute: one query
for your tasks changed since the last check, plus one per changed task for its comments,
at most 25 tasks per check (the rest wait for the next minute). When fewer than 15
requests are left in ClickUp's window, it skips a check and says so on the connection.

## Not covered (yet)

- Tasks you only **watch** or created but are not assigned to — the API has no filter
  for them.
- **Replies inside comment threads** — only top-level comments are read.
- Mentions in **Docs** and **Chat**.
