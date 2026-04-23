Agentic Village (Global)

This config repo defines a 3-agent village:
- `mayor`
- `worker`
- `overseer`

Key pieces

- Agents: `agents/mayor.md`, `agents/worker.md`, `agents/overseer.md`
- Plugin: `plugins/village.ts`
  - Injects `BD_ACTOR`
  - Adds tools: `village_claim`, `village_handoff`, `village_scaffold`, `village_orphans`, `village_status`
- Public skills: `skills/*/SKILL.md`
- Private skills (local-only): `skills-private/*/SKILL.md` (gitignored)

Private skills

1. Create a private skill folder:
   - `~/.config/opencode/skills-private/project-myrepo/SKILL.md`
2. Keep private skills free of secret values (no private keys, tokens, seed phrases).

Running the workflow

1. Start OpenCode in your project repo and use `mayor`.
2. Mayor clarifies scope, drafts an epic + child beads, and creates them (preferred: `village_scaffold`; fallback: `br create`).
3. Navigate to worker/overseer sessions: `ctrl+x right/left` (cycle children) and `ctrl+x up` (back to parent). Run `/village:work` to start.
4. Worker implements, commits locally, then reassigns bead to overseer.
5. Overseer runs checks and either closes the bead or returns it to worker.

Notes

- Mayor never makes code/config/doc changes; it only creates beads.
- Spawning multiple workers in the same git working directory can cause conflicts.
- Claiming work should be done via `village_claim` (enforces at most 1 in_progress bead per assignee).

`/village:orphans` shortcut

- Use `/village:orphans` to report non-epic open/in-progress beads that are unassigned, plus beads assigned outside `worker`/`overseer`.
- The report also surfaces ignored epics for observability (epics are never auto-assigned).
- Use `/village:orphans fix` to auto-assign only truly unassigned non-epic beads with a safe heuristic.
- It does not reshuffle existing assignments or modify epics.
- Examples:
  - `/village:orphans`
  - `/village:orphans fix`
