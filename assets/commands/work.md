# /village:work

Trigger the village work loop for your role.

## Template

Claim the next bead assigned to you and start working on it.

Use this workflow:
1. Claim deterministically by calling `village_claim` (single in_progress guard):
   - `existing in_progress: <id> | ...` => continue that bead
   - `claimed: <id> | ...` => start that bead
   - `no ready beads for worker` / `no ready beads for overseer` => report and wait
2. Read the bead details and handoff packet: `br show <id> --json`
3. Load skills listed under `## Skills`
4. Do the work for your role (worker: implement + local commit; overseer: run checks + approve/return)
5. Update bead status/comments and repeat from step 1

Important: do not claim work via `br ready` + `br update ... in_progress`; use `village_claim` so the single in_progress guard is enforced.
