# /village:work

Trigger the village work loop for your role.

## Template

Claim the next bead assigned to you and start working on it.

**Important distinction:** Village tools (`village_claim`, `village_handoff`, `village_board`, etc.) are OpenCode plugin tools — invoke them via the tool-calling interface, NOT as shell commands. **Always prefer a plugin tool over an equivalent `br` shell command.** Shell commands like `br show`, `git status` are run via Bash only when no tool alternative exists.

Use this workflow:
1. Claim deterministically by invoking the **village_claim** tool (single in_progress guard):
   - `existing in_progress: <id> | ...` => continue that bead
   - `claimed: <id> | ...` => start that bead
   - `no ready beads for worker` / `no ready beads for inspector` / `no ready beads for guard` => report and wait
2. Read the bead details and handoff packet: `br show <id> --json` (shell command)
3. Load skills listed under `## Skills`
4. Do the work for your role (worker: implement + local commit; inspector: read-only judgment + handoff; guard: run checks + approve/return)
5. Update bead status/comments and repeat from step 1

Important: do not claim work via `br ready` + `br update ... in_progress`; invoke the **village_claim** tool so the single in_progress guard is enforced.
