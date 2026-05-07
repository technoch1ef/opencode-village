# /village:close

Close the current in-progress bead immediately, bypassing all remaining village roles.

## Template

Auto-detect the single in-progress bead and close it directly, skipping any remaining guard/inspector/envoy steps.

All village operations go through plugin tools (`village_board`, etc.). Invoke them via the tool-calling interface, not as shell commands.

Use this workflow:

1. Invoke **village_board** to get a snapshot of the current village state.
2. Identify all beads that are currently `in_progress` (across all roles).
   - If **zero** in-progress beads are found: report "No in-progress bead found. Nothing to close." and stop.
   - If **more than one** in-progress bead is found: report "Multiple in-progress beads found: <list ids>. Cannot auto-detect which to close. Please specify." and stop.
3. Close the bead directly using `br close <id> --reason "Closed by human via /village:close — remaining roles skipped"`.
4. Report the outcome: "Bead `<id>` closed. Remaining village roles were skipped."

Important:
- This command takes **no arguments** — it relies entirely on auto-detection.
- This is the nuclear option: no guard checks, no inspector review, no envoy step.
- Always use bead close (not `village_handoff`) regardless of the current assignee role.
- Always include "Closed by human via /village:close" in the close reason for traceability.
