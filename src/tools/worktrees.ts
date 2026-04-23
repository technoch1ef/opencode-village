/**
 * `village_worktrees` tool — list current worktree → bead mapping.
 *
 * Shows which beads are in-progress in which git worktrees,
 * helping diagnose worktree conflicts.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import type { SessionHelpers } from "../lib/sessions";
import { getWorktreeMapping } from "../lib/worktree";

/**
 * Create the `village_worktrees` tool definition, bound to session helpers.
 */
export function createWorktreesTool(helpers: SessionHelpers) {
  return tool({
    description:
      "List the current worktree → bead mapping for all in-progress beads. " +
      "Shows which beads are active in which git worktrees.",
    args: {
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const actor = await helpers.resolveActor(context.sessionID);

      const entries = await getWorktreeMapping({
        cwd: directory,
        actor,
      });

      if (entries.length === 0) {
        return "No in-progress beads with worktree information found.";
      }

      const lines: string[] = [];
      lines.push("Worktree → Bead mapping:");
      lines.push("");
      for (const entry of entries) {
        lines.push(
          `${entry.worktreePath} → ${entry.beadId} | ${entry.beadTitle} | ${entry.assignee}`,
        );
      }

      return lines.join("\n");
    },
  });
}
