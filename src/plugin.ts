/**
 * OpenCode Village Plugin
 *
 * Enables a lightweight "Agentic Village" workflow.
 *
 * Features:
 * - Injects BD_ACTOR environment variable based on current agent
 * - Provides tools: village_board, village_claim, village_detect_stack, village_ensure_branch, village_handoff, village_invoke, village_lint, village_scaffold, village_orphans, village_status, village_worktrees
 * - Monitors village session errors and status transitions
 */

import type { Plugin } from "@opencode-ai/plugin";
import { AGENT_TO_ACTOR } from "./lib/br";
import { createSessionHelpers } from "./lib/sessions";
import { fixShellSnippetNewlines } from "./lib/shared";
import { createBoardTool } from "./tools/board";
import { createClaimTool } from "./tools/claim";
import { createDetectStackTool } from "./tools/detect-stack";
import { createEnsureBranchTool } from "./tools/ensure-branch";
import { createHandoffTool } from "./tools/handoff";
import { createInvokeTool } from "./tools/invoke";
import { createLintTool } from "./tools/lint";
import { createOrphansTool } from "./tools/orphans";
import { createScaffoldTool } from "./tools/scaffold";
import { createStatusTool } from "./tools/status";
import { createWorktreesTool } from "./tools/worktrees";

/**
 * Create the village event handler for session error/status monitoring.
 */
function createEventHandler(helpers: ReturnType<typeof createSessionHelpers>) {
  return async ({ event }: { event: { type: string; properties?: any } }) => {
    const properties = (event.properties ?? {}) as any;

    const sessionID =
      typeof properties.sessionID === "string"
        ? properties.sessionID
        : typeof properties.id === "string"
          ? properties.id
          : undefined;
    if (!sessionID) return;

    if (event.type === "session.error") {
      const session = await helpers.getVillageSessionSummary(sessionID);
      if (!session) return;

      const errorText =
        typeof properties.error === "string"
          ? properties.error
          : typeof properties.message === "string"
            ? properties.message
            : typeof properties.error?.message === "string"
              ? properties.error.message
              : "Unknown error";

      const dedupeKey = `${session.id}:${errorText}`;
      if (helpers.seenErrorKeys.has(dedupeKey)) return;
      helpers.seenErrorKeys.add(dedupeKey);

      await helpers.showVillageToast({
        sessionID,
        title: "Village session error",
        message: `${session.title} (${session.id}) failed: ${errorText}`,
        variant: "error",
        duration: 5000,
      });
      return;
    }

    if (event.type === "session.status") {
      const session = await helpers.getVillageSessionSummary(sessionID);
      if (!session) return;

      const status =
        typeof properties.status === "string"
          ? properties.status
          : typeof properties.next === "string"
            ? properties.next
            : undefined;
      if (!status) return;

      const previous = helpers.lastVillageStatus.get(sessionID);
      if (previous === status) return;
      helpers.lastVillageStatus.set(sessionID, status);

      if (previous === "running" && status === "idle") {
        await helpers.showVillageToast({
          sessionID,
          title: "Village session idle",
          message: `${session.title} (${session.id}) is now idle`,
          variant: "info",
          duration: 2500,
        });
      }
    }
  };
}

const VillagePlugin: Plugin = async ({ client }) => {
  const helpers = createSessionHelpers(client);

  return {
    "shell.env": async (input, output) => {
      const agent = (input as any).agent;
      if (agent && AGENT_TO_ACTOR[agent]) {
        output.env.BD_ACTOR = AGENT_TO_ACTOR[agent];
      }
    },

    "experimental.text.complete": async (_input, output) => {
      const fixed = fixShellSnippetNewlines(output.text);
      if (typeof fixed === "string") output.text = fixed;
    },

    tool: {
      village_board: createBoardTool(helpers),
      village_claim: createClaimTool(helpers),
      village_detect_stack: createDetectStackTool(),
      village_ensure_branch: createEnsureBranchTool(),
      village_handoff: createHandoffTool(helpers),
      village_invoke: createInvokeTool(helpers),
      village_lint: createLintTool(helpers),
      village_scaffold: createScaffoldTool(helpers),
      village_orphans: createOrphansTool(helpers),
      village_status: createStatusTool(helpers),
      village_worktrees: createWorktreesTool(helpers),
    },

    event: createEventHandler(helpers),
  };
};

export default VillagePlugin;
