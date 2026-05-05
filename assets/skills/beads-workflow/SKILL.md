---
name: beads-workflow
description: Beads-based epic/task workflow with skill-driven workers, inspectors, and guards.
---

## Bead body template (recommended)

Include these sections in every implementation bead:

```md
## Context

## Skills
- beads-workflow
- stack-<...>

## Branch
`epic/<name>`

## Acceptance Criteria
- [ ] ...

## Notes
```

## Roles
- Mayor: research, ask clarifying questions, draft epic + child beads, include `## Skills`, create beads with `br`; no code changes
- Worker: implement bead only; may create local commits; no pushes; no test runs
- Guard: run linters/tests/build; hand off to inspector on green or return to worker on red
- Inspector: review acceptance criteria, code quality, scope; read-only; close beads on approval or return to worker

## Status + assignee flow (recommended)
- Mayor creates child beads assigned to `worker` (status defaults to `open`)
- Worker:
  - Start work: `br update <id> --assignee worker --status in_progress`
  - Handoff: `br update <id> --assignee guard --status open`
- Guard:
  - Start checks: `br update <id> --assignee guard --status in_progress`
  - Approve (send to inspector): `br update <id> --assignee inspector --status open`
  - Request changes: `br update <id> --assignee worker --status open`
- Inspector:
  - Start review: `br update <id> --assignee inspector --status in_progress`
  - Approve: `br close <id> --reason "Approved"`
  - Request changes: `br update <id> --assignee worker --status open`
- Use `blocked` when genuinely blocked, not for "in review".

## Private skills (centralized)
- Store private, per-project skills in: `~/.config/opencode/skills-private/<name>/SKILL.md`
- Keep private skills free of secret values (no private keys, tokens, seed phrases)
