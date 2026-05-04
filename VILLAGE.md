Agentic Village

This plugin defines a 5-role village workflow for OpenCode:
- `mayor` — research, plan, create epics and child beads
- `worker` — implement bead tasks, make local commits, hand off to inspector
- `inspector` — read-only judgment: AC coverage, scope check, regression sniff
- `guard` — run tests/linters/build, close beads on green or return to worker
- `envoy` — push branches, create PRs, handle releases (optional terminal step)

Key pieces

- Agents: `agents/{mayor,worker,inspector,guard,envoy}.md`
- Tools: `village_claim`, `village_handoff`, `village_scaffold`, `village_lint`, `village_board`, `village_ensure_branch`, `village_invoke`, `village_orphans`, `village_status`, `village_worktrees`
- Public skills: `skills/*/SKILL.md`
- Private skills (local-only): `skills-private/*/SKILL.md` (gitignored)

Commands

All slash commands are namespaced under `/village:`:

| Command | Description |
|---------|-------------|
| `/village:work` | Trigger the work loop for the current agent's role |
| `/village:board` | Show a read-only at-a-glance view of village state |
| `/village:envoy` | Dispatch envoy to push a branch and open a PR |
| `/village:orphans` | Report and optionally fix unassigned beads |

Commands are installed under `commands/village/` (subdirectory → `/village:` namespace in OpenCode).

Private skills

1. Create a private skill folder:
   - `~/.config/opencode/skills-private/project-myrepo/SKILL.md`
2. Keep private skills free of secret values (no private keys, tokens, seed phrases).

Running the workflow

1. Start OpenCode in your project repo and use `mayor`.
2. Mayor clarifies scope, drafts an epic + child beads, and creates them (preferred: `village_scaffold`; fallback: `br create`).
3. Navigate to worker/inspector/guard sessions: `ctrl+x right/left` (cycle children) and `ctrl+x up` (back to parent). Run `/village:work` to start.
4. Worker implements, commits locally, then hands off bead to inspector.
5. Inspector reviews read-only — verifies AC coverage, scope, regressions — then hands off to guard.
6. Guard runs checks (tests/linters/build) and either closes the bead or returns it to worker.
7. Optionally, envoy pushes branches and opens PRs via `/village:envoy`.

Notes

- Mayor never makes code/config/doc changes; it only creates beads.
- Spawning multiple workers in the same git working directory can cause conflicts.
- Claiming work should be done via `village_claim` (enforces at most 1 in_progress bead per assignee).
