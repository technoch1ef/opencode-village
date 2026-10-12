/**
 * OpenCode Village Plugin (OpenCode v2 plugin API)
 *
 * Enables a lightweight "Agentic Village" workflow.
 *
 * Features:
 * - Provides tools: village_board, village_claim, village_ensure_branch, village_handoff, village_invoke, village_lint, village_scaffold, village_orphans, village_worktrees
 */

import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { startBrPreflight, withBrPreflight } from "./lib/preflight";
import { createSessionHelpers } from "./lib/sessions";
import type { ToolDefinition } from "./lib/tool";
import { createBoardTool } from "./tools/board";
import { createClaimTool } from "./tools/claim";
import { createEnsureBranchTool } from "./tools/ensure-branch";
import { createHandoffTool } from "./tools/handoff";
import { createInvokeTool } from "./tools/invoke";
import { createLintTool } from "./tools/lint";
import { createOrphansTool } from "./tools/orphans";
import { createScaffoldTool } from "./tools/scaffold";
import { createWorktreesTool } from "./tools/worktrees";

const VillagePlugin: Plugin.Plugin = {
  id: "village",
  async setup(ctx) {
    const helpers = createSessionHelpers(ctx.session);

    // Fire-and-forget `br --version` preflight check.
    // On failure, a single warning is written to stderr and all village_* tools
    // will return a clear error instead of crashing with cryptic ENOENT messages.
    void startBrPreflight();

    const tools: Record<string, ToolDefinition<any>> = {
      village_board: createBoardTool(helpers),
      village_claim: createClaimTool(helpers),
      village_ensure_branch: createEnsureBranchTool(),
      village_handoff: createHandoffTool(helpers),
      village_invoke: createInvokeTool(helpers),
      village_lint: createLintTool(helpers),
      village_scaffold: createScaffoldTool(helpers),
      village_orphans: createOrphansTool(helpers),
      village_worktrees: createWorktreesTool(helpers),
    };

    const registration = await ctx.tool.transform((editor) => {
      for (const [name, def] of Object.entries(tools)) {
        const wrapped = withBrPreflight(def);
        editor.add({
          name,
          description: def.description,
          input: z.object(def.args),
          // Agent prompts call village_* tools directly, not through code mode.
          options: { codemode: false },
          async execute(input, context) {
            const session = await helpers.getSession(context.sessionID);
            const content = await wrapped.execute(input, {
              sessionID: context.sessionID,
              agent: context.agent,
              directory: session?.location?.directory ?? ctx.location.directory,
            });
            return { content: String(content) };
          },
        });
      }
    });

    return () => registration.dispose();
  },
};

export default VillagePlugin;
