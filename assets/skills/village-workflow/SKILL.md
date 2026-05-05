---
name: village-workflow
description: Agentic Village epic/task workflow — roles, status flow, and handoff conventions driven by village_* plugin tools.
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
