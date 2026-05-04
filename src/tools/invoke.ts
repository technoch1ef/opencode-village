/**
 * `village_invoke` tool — dispatch a bead to an optional specialist (e.g. envoy).
 *
 * Tags the bead with a `[village] needs <specialist>` comment so that:
 * - The specialist's `village_claim` variant picks it up
 * - The default `village_claim` queue (worker/inspector/guard) ignores it
 *
 * Extensible: adding new specialists in future is just a new agent + new
 * entry in the `SPECIALISTS` set.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson, execFileText, formatIssueLine } from "../lib/br";
import type { SessionHelpers } from "../lib/sessions";
import type { BrIssue } from "../lib/shared";
import { inferRoleFromTitle, VILLAGE_ROLES } from "./handoff";

/** Valid specialist roles that can be invoked. */
export const SPECIALISTS = new Set(["envoy"] as const);

/** The type of a valid specialist name. */
export type Specialist = "envoy";

/**
 * The comment marker prefix used to tag beads for specialist dispatch.
 *
 * Format: `[village] needs <specialist>: <note>`
 */
export const SPECIALIST_MARKER_PREFIX = "[village] needs ";

/**
 * Build the specialist dispatch comment.
 */
export function formatSpecialistComment(
  specialist: string,
  note?: string,
): string {
  const suffix = note ? `: ${note}` : "";
  return `${SPECIALIST_MARKER_PREFIX}${specialist}${suffix}`;
}

/**
 * Check whether a bead's comments contain a specialist dispatch marker.
 *
 * When `specialist` is provided, checks for that specific specialist.
 * When `specialist` is omitted, checks for any specialist marker.
 */
export function hasSpecialistMarker(
  comments: Array<{ text?: string }>,
  specialist?: string,
): boolean {
  const prefix = specialist
    ? `${SPECIALIST_MARKER_PREFIX}${specialist}`
    : SPECIALIST_MARKER_PREFIX;
  return comments.some(
    (c) => typeof c.text === "string" && c.text.startsWith(prefix),
  );
}

/**
 * Extract the specialist name from a dispatch marker comment.
 *
 * Returns `undefined` if the comment does not contain a marker.
 */
export function parseSpecialistFromComment(
  text: string,
): string | undefined {
  if (!text.startsWith(SPECIALIST_MARKER_PREFIX)) return undefined;
  const rest = text.slice(SPECIALIST_MARKER_PREFIX.length);
  // specialist name is everything up to `:` or end of string
  const colonIdx = rest.indexOf(":");
  return (colonIdx >= 0 ? rest.slice(0, colonIdx) : rest).trim() || undefined;
}

/**
 * Create the `village_invoke` tool definition, bound to session helpers.
 */
export function createInvokeTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Dispatch a bead to an optional specialist (e.g. envoy) for processing. " +
      "Tags the bead with a specialist marker comment and reassigns it.",
    args: {
      specialist: tool.schema.enum(["envoy"] as const),
      bead: tool.schema.string(),
      note: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = context.directory;

      // Resolve the current actor via fallback chain (same as village_handoff):
      //   1. Primary: session.agent
      //   2. Fallback 1: infer role from session.title pattern
      //   3. Fallback 2: walk to session.parentID and read its .agent
      const session = await helpers.getSession(context.sessionID);
      const sessionAgent = (session as any)?.agent as string | undefined;

      let actor: string = sessionAgent ?? "unknown";

      // Fallback 1: infer from session title.
      if (!VILLAGE_ROLES.has(actor)) {
        const title = (session as any)?.title as string | undefined;
        const inferred = inferRoleFromTitle(title);
        if (inferred) actor = inferred;
      }

      // Fallback 2: walk to parentID and read its agent.
      if (!VILLAGE_ROLES.has(actor)) {
        try {
          const parentID = (session as any)?.parentID as string | undefined;
          if (parentID) {
            const parent = await helpers.getSession(parentID);
            const parentAgent = (parent as any)?.agent as string | undefined;
            if (parentAgent && VILLAGE_ROLES.has(parentAgent)) {
              actor = parentAgent;
            }
          }
        } catch {
          // Best-effort: network call to parent session may fail.
        }
      }

      if (!SPECIALISTS.has(args.specialist as Specialist)) {
        throw new Error(
          `village_invoke: unknown specialist "${args.specialist}". Valid: ${[...SPECIALISTS].join(", ")}`,
        );
      }

      // Post the specialist dispatch marker comment.
      const comment = formatSpecialistComment(args.specialist, args.note);
      await execFileText("br", ["comments", "add", args.bead, comment], {
        cwd: directory,
        env: { ...process.env, BD_ACTOR: actor },
      });

      // Reassign bead to specialist + status=open.
      const out = await execBrJson<BrIssue[]>(
        [
          "update",
          args.bead,
          "--assignee",
          args.specialist,
          "--status",
          "open",
          "--json",
        ],
        { cwd: directory, actor },
      );

      const updated = Array.isArray(out) ? out[0] : undefined;
      if (!updated) {
        throw new Error(
          `village_invoke: br update returned no result for ${args.bead}`,
        );
      }

      return `invoked ${args.specialist}: ${formatIssueLine(updated)}`;
    },
  });
}
