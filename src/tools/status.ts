/**
 * `village_status` tool — list village sessions under the root session.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import type { SessionHelpers } from "../lib/sessions";

/**
 * Create the `village_status` tool definition, bound to session helpers.
 */
export function createStatusTool(helpers: SessionHelpers) {
  return tool({
    description:
      "List village sessions under the current root session (IDs and titles).",
    args: {},
    async execute(_args, context) {
      const rootID = await helpers.getRootSessionID(context.sessionID);
      const sessions = await helpers.listVillageSessions(rootID);

      return [
        `Root session: ${rootID}`,
        helpers.formatSessionList("Workers", sessions.workers),
        helpers.formatSessionList("Inspectors", sessions.inspectors),
        helpers.formatSessionList("Guards", sessions.guards),
      ].join("\n");
    },
  });
}
