# /village:orphans

Report and fix unassigned village beads.

## Template

Find orphan and suspect-assignee beads from open + in_progress work, then auto-assign them.

Invoke the **village_orphans** tool. It will:

1. Run the necessary preflight checks (warning if village backing store is unavailable).
2. Read open + in_progress beads.
3. Filter and report orphans/suspect assignees.
4. Auto-assign all orphan non-epic beads to the inferred role.
