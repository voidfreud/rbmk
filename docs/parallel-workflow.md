# Parallel work protocol (protect `main`, integrate on `grok`)

How this project runs multi-agent / multi-worktree work. Use this wording
with humans and agents so everyone means the same thing.

## One-liner (say this)

> **Feature branch `grok` is the integration tip. Parallel agents each get an
> isolated worktree on a short-lived `grok/*` branch forked from `grok`.
> Nothing merges to `main` until we explicitly promote.**

That is the whole contract.

## Vocabulary (tech → plain)

| Term | Meaning here |
|------|----------------|
| **Integration branch** | Long-lived feature branch: **`grok`**. All finished work lands here first. |
| **Protected base** | **`main`**. Do not check out for agent work; do not merge into it mid-iteration. |
| **Agent branch / topic branch** | Short-lived branch named **`grok/<task>`** (e.g. `grok/p0-core`), forked **from current `grok`**. |
| **Worktree** | Extra checkout directory of the same repo, usually one branch per tree. Lets two agents edit without sharing one working directory. |
| **Isolated worktree** | Agent runs in its own worktree (`isolation: "worktree"`). Parent tree stays clean until merge. |
| **Integrate / merge down** | Merge `grok/<task>` **into `grok`** (not into `main`). |
| **Promote** | Later, deliberate merge/PR: `grok` → `main`. Only when we ask for it. |

## Topology

```
main                    ← frozen until explicit promote
  │
  └── grok              ← integration branch (primary checkout)
        ├── grok/p0-core     (agent worktree, temp)
        ├── grok/p0-ui       (agent worktree, temp)
        └── grok/ux-tooltips (agent worktree, temp)
```

## Rules

1. **Primary folder stays on `grok`.** Owner and orchestrator integrate here.
2. **Agents never target `main`.** No commits, checkouts, or merges to `main`.
3. **One branch name per worktree.** Git forbids two worktrees on the same branch. So agents use `grok/<task>`, not a second `grok`.
4. **Fork from `grok`, not from `main`.**  
   `git checkout -b grok/<task> grok` (or equivalent from current `grok` HEAD).
5. **Merge only into `grok`.** After review/tests: merge topic → `grok`, then delete topic branch / worktree.
6. **Push policy:** push `grok` after integration checkpoints (project agreement). Topic branches may stay local unless useful for recovery.
7. **File ownership while parallel:** each agent owns a non-overlapping path set. If two agents need the same file, serialize that slice or assign one owner.

## How to request this (copy-paste phrases)

Any of these should trigger the same behavior:

- “Parallel on the **grok lineage**; **protect main**.”
- “**Integration branch `grok`**; agent branches **`grok/*`**; worktree isolation.”
- “Multi-agent with **isolated worktrees**, merge **into `grok` only**.”
- “Same as `docs/parallel-workflow.md`.”

What **not** to say if you mean this:

- “Branch off main for each agent” → puts pressure on `main` as the hub.
- “All agents on branch grok” → git cannot mount `grok` twice; use `grok/*`.

## Agent briefing template

```
Base: current grok HEAD (not main).
Create branch: grok/<short-task-name>
Work in isolated worktree only.
Touch only: <file list>
Commit on grok/<task> with a clear message.
Do not merge to main. Do not push main. Do not rewrite grok history.
When done: report branch name, commit hash, files changed, test results.
Parent will merge into grok.
```

## Orchestrator checklist

- [ ] On `grok`, working tree clean (or only intentional WIP committed)
- [ ] Split tasks by **non-overlapping paths**
- [ ] Spawn agents with worktree isolation; brief with template above
- [ ] Wait for completion; run tests on each topic if needed
- [ ] Merge each `grok/<task>` → `grok` (resolve conflicts once, here)
- [ ] `bun test` (and UI smoke if UI changed) on integrated `grok`
- [ ] Commit/push `grok` checkpoint; delete temp branches/worktrees
- [ ] Leave `main` unchanged

## Why not “everyone on main with worktrees”?

`main` would accumulate partial merges and force the team to treat production
history as a scratch pad. **`grok` is the scratch pad; `main` is the last
known good line we promote to.**
