---
name: village-workflow
description: Agentic Village epic/task workflow — roles, status flow, and handoff conventions driven by village_* plugin tools. Use ONLY when acting as a village role (mayor, worker, guard, inspector, envoy) or when the user explicitly requests village/beads work. Default agents (build, plan, explore, general) must not load this skill.
---

The village workflow coordinates five roles (mayor, worker, guard, inspector, envoy) through a deterministic chain of plugin tools. Always prefer a `village_*` tool over any equivalent shell command.

## Bead body template

Every implementation bead must include these sections (validated by `village_lint` and `village_scaffold`):

```md
## Context

## Skills
- village-workflow

## Branch
`epic/<name>`

## Acceptance Criteria
- [ ] ...

## Notes
```

## Roles

- **Mayor** — research, ask clarifying questions, draft an epic + child beads (each with `## Skills`), create them via `village_scaffold`. No code changes.
- **Worker** — implement exactly what the bead asks for, make local commits, hand off to guard. No tests, no pushes.
- **Guard** — run linters/tests/build/coverage. Hand off to inspector on green or back to worker on red. No edits.
- **Inspector** — read-only judgment: AC coverage, scope, regression sniff. Close the bead on approval or return to worker.
- **Envoy** — push branches and open PRs. Optional terminal step, invoked via `village_invoke` or `/village:envoy`.

## Status + assignee flow

All transitions go through plugin tools. Use `blocked` only when genuinely blocked, never as "in review".

| From → To | Tool |
|-----------|------|
| (initial) ready bead → start work | `village_claim` |
| worker → guard | `village_handoff { to: "guard" }` |
| guard → inspector | `village_handoff { to: "inspector" }` |
| guard → worker (red) | `village_handoff { to: "worker" }` |
| inspector → worker (changes requested) | `village_handoff { to: "worker" }` |
| inspector → mayor (out of scope) | `village_handoff { to: "mayor" }` |
| inspector → envoy (PR requested) | `village_handoff { to: "envoy" }` |
| inspector → close (approval) | terminal close on the bead |
| envoy → close (after merge) | terminal close on the bead |

The mayor never claims; the envoy is dispatched explicitly via `village_invoke` or the `/village:envoy` slash command.

## Tool reference

| Tool | When to use |
|------|-------------|
| `village_claim` | Pick the next ready bead (single in_progress guard per role). |
| `village_handoff` | Atomically post a handoff comment + reassign + set status. |
| `village_scaffold` | Create an epic and child beads with linkage and lint validation. |
| `village_lint` | Validate an existing bead body before claiming work. |
| `village_board` | Read-only ASCII board (roles × statuses). |
| `village_ensure_branch` | Create or fast-forward an `epic/*` branch from the default base. |
| `village_invoke` | Dispatch a bead to a specialist (envoy). |
| `village_orphans` | Report and auto-assign orphan/suspect-assignee beads. |
| `village_status` | List village sessions under the current root session. |
| `village_worktrees` | Show the current worktree → bead mapping. |

## Commit hygiene

The `.beads/` directory may be gitignored in a project. Never explicitly stage it (`git add .beads/`) or force-add it (`git add -f .beads/`). Use `git add -A`, which respects `.gitignore` automatically. If the directory is tracked (not gitignored), `git add -A` will include it with no special handling needed.

## Beads CLI essentials

**Note:** `br` is non-invasive and never executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

- Village roles use Beads for all work tracking (`br create`, `br update`, `br close`) — never markdown files or TodoWrite.
- If you were dropped into a new/compacted village session, run `br prime` to recover Beads context.
- Keep bead bodies free of secrets (no tokens/keys/seed phrases).
- Priority: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words).
- Types: task, bug, feature, epic, question, docs.

```bash
br ready
br list --status open
br show <id>
br update <id> --status in_progress
br close <id> --reason "..."
```

### Shell snippets (copy/paste safe)

- Avoid literal `\n` tokens between commands (e.g. `br create ...; \nbr update ...`); in zsh/bash, `\nbr` is parsed as `nbr`.
- Prefer fenced code blocks with real newlines, or `&&`/`;` separators on a single line:

```bash
br create "..." && br update <id> --status in_progress
```

### Session close protocol

Before ending any village session:

```bash
git status
git add <files>
br sync --flush-only
git add .beads/
git commit -m "..."
```

## Cross-repo handoff template

When a bead's work is complete and the next agent (in this repo or another) needs context, post a structured handoff comment on the bead with **exactly** this shape:

```md
## Handoff Summary
- Goal:
- Current status:
- What changed (files + brief):

## Interface / Contract Changes
- Endpoints / schema changes:
- Sample requests/responses:
- Error cases:

## How to verify
- Commands run + results:
- Remaining tests to run:

## Next repo tasks (copy/paste)
- Task 1:
- Task 2:
- Acceptance criteria:
```

This template is also appropriate for the body of a follow-up bead created in another repository.

## Private skills

- Store private, per-project skills under `~/.config/opencode/skills-private/<name>/SKILL.md`.
- Keep skills and bead bodies free of secret values (no private keys, tokens, seed phrases).
