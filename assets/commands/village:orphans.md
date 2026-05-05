# /village:orphans

Report and fix unassigned village beads.

## Template

Find orphan and suspect-assignee beads from open + in_progress work, then auto-assign them.

Behavior:
1. Graceful preflight:
   - If `br` is unavailable, return: `br not available; cannot inspect beads.`
   - If beads DB is missing in this repo, return: `No .beads database found; nothing to inspect.`
2. Read data:
   - Run `br list --status open --json`
   - Run `br list --status in_progress --json`
   - Combine both lists.
3. Filter and report orphans/suspect assignees.
4. Auto-assign all orphan non-epic beads to the inferred role.
