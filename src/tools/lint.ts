/**
 * `village_lint` tool — validate an existing bead's body without modifying it.
 *
 * Reads the bead's description and runs the structured linter against it,
 * reporting any missing/invalid sections.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson } from "../lib/br";
import {
  defaultSkillRegistryPaths,
  lintBeadBody,
  scanSkillRegistry,
} from "../lib/lint";
import type { SessionHelpers } from "../lib/sessions";
import type { BrIssue } from "../lib/shared";

/**
 * Create the `village_lint` tool definition, bound to session helpers.
 */
export function createLintTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Validate an existing bead's body for required sections and content. " +
      "Reports missing/invalid sections without modifying the bead. " +
      "Useful for checking bead quality before claiming work.",
    args: {
      bead: tool.schema.string(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const actor = await helpers.resolveActor(context.sessionID);

      const beadId = args.bead.trim();
      if (!beadId) throw new Error("bead ID is required");

      // Fetch the bead.
      const out = await execBrJson<BrIssue[]>(
        ["show", beadId, "--json"],
        { cwd: directory, actor },
      );
      const issue = Array.isArray(out) ? out[0] : undefined;
      if (!issue) throw new Error(`bead not found: ${beadId}`);

      const body = issue.description ?? "";
      if (!body.trim()) {
        return `${beadId}: FAIL — bead has no description body`;
      }

      const isEpic = (issue.issue_type ?? "").toLowerCase() === "epic";

      // Scan skills registry.
      const registryPaths = defaultSkillRegistryPaths(directory);
      const knownSkills = await scanSkillRegistry(registryPaths);

      const result = lintBeadBody(body, { isEpic, knownSkills });

      if (result.ok) {
        return `${beadId}: OK — all required sections present and valid`;
      }

      const lines: string[] = [];
      lines.push(`${beadId}: FAIL — ${result.errors.length} issue(s) found:`);
      for (const err of result.errors) {
        lines.push(`  - ${err}`);
      }
      return lines.join("\n");
    },
  });
}
