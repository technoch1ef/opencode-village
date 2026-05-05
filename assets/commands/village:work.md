# /village:work

Trigger the village work loop for your role.

## Template

Claim the next bead assigned to you and start working on it.

All village operations go through plugin tools (`village_claim`, `village_handoff`, `village_board`, etc.). Invoke them via the tool-calling interface, not as shell commands.

Use this workflow:

1. Claim deterministically by invoking the **village_claim** tool (single in_progress guard):
   - `existing in_progress: <id> | ...` → continue that bead
   - `claimed: <id> | ...` → start that bead
   - `no ready beads for worker` / `no ready beads for inspector` / `no ready beads for guard` → report and wait
2. Read the bead body and handoff history.
3. Load the skills listed under `## Skills`.
4. Do the work for your role:
   - **worker**: implement + local commit, then hand off to guard via **village_handoff**.
   - **guard**: run checks, then hand off to inspector (green) or worker (red) via **village_handoff**.
   - **inspector**: read-only judgment, then close on approval or hand off via **village_handoff**.
5. Repeat from step 1.

Important: do not bypass **village_claim** with manual status updates — the tool enforces the single in_progress guard per role.
