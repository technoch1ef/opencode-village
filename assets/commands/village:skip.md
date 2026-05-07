# /village:skip

Skip the current in-progress bead one step forward in the village chain.

## Template

Auto-detect the single in-progress bead and advance it to the next role without performing its work.

All village operations go through plugin tools (`village_board`, `village_handoff`, etc.). Invoke them via the tool-calling interface, not as shell commands.

Use this workflow:

1. Invoke **village_board** to get a snapshot of the current village state.
2. Identify all beads that are currently `in_progress` (across all roles).
   - If **zero** in-progress beads are found: report "No in-progress bead found. Nothing to skip." and stop.
   - If **more than one** in-progress bead is found: report "Multiple in-progress beads found: <list ids>. Cannot auto-detect which to skip. Please specify." and stop.
3. From the single in-progress bead, determine the **current assignee role** (worker, guard, inspector, or envoy).
4. Advance the bead based on the current role:

   | Current Role | Action |
   |--------------|--------|
   | **worker** | Invoke `village_handoff { bead: "<id>", to: "guard", note: "Skipped by human via /village:skip" }` |
   | **guard** | Invoke `village_handoff { bead: "<id>", to: "inspector", note: "Skipped by human via /village:skip" }` |
   | **inspector** | Close the bead with reason: "Approved (skipped by human via /village:skip)" |
   | **envoy** | Close the bead with reason: "Completed (skipped by human via /village:skip)" |

5. Report the outcome: "Bead `<id>` skipped from <role> to <next step>."

Important:
- This command takes **no arguments** — it relies entirely on auto-detection.
- Use `village_handoff` for role transitions (worker→guard, guard→inspector).
- For terminal steps (inspector, envoy), close the bead directly.
- Always include "Skipped by human via /village:skip" in handoff notes and close reasons for traceability.
