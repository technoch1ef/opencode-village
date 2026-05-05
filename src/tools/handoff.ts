/**
 * `village_handoff` tool — atomic bead handoff between village roles.
 *
 * Replaces the manual two-step:
 *   `br comments add <id> "..." && br update <id> --assignee X --status open`
 * with a single atomic tool call.
 *
 * **Handoff chain:** mayor -> worker -> guard -> inspector -> envoy (optional).
 *
 * **Allowed handoff matrix:**
 * - worker -> guard (default after implementation)
 * - guard -> inspector (checks passed) | worker (checks failed)
 *   - guard does NOT close beads; it always hands off to inspector on green
 * - inspector -> worker (changes requested) | mayor (out of scope) | envoy (only if bead body explicitly requests release/PR)
 *   - inspector closes the bead itself on approval (no handoff needed)
 * - mayor -> worker (rescope)
 * - envoy -> (none; envoy closes or returns to inspector with comment)
 *
 * **Closing happens at the end of the chain:**
 * - inspector closes on approval (default terminal)
 * - envoy closes after merge (if invoked)
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson, execFileText, formatIssueLine } from "../lib/br";
import type { SessionHelpers } from "../lib/sessions";
import type { BrIssue } from "../lib/shared";

/** Village roles that participate in the handoff chain. */
export type VillageRole = "mayor" | "worker" | "inspector" | "guard" | "envoy";

/** All valid village roles. */
export const VILLAGE_ROLES: ReadonlySet<string> = new Set<VillageRole>([
  "mayor",
  "worker",
  "inspector",
  "guard",
  "envoy",
]);

/**
 * Infer a village role from a session title.
 *
 * Session titles follow patterns like `village-worker-bd-2kk9.11`,
 * `village-inspector`, `village-guard-check`, etc.
 * (see {@link import("../lib/sessions").isVillageSessionTitle}).
 *
 * Iterates over {@link VILLAGE_ROLES} and returns the first match
 * where the title starts with `village-<role>-` or equals `village-<role>`.
 *
 * @returns The matched role string, or `undefined` if no match.
 */
export function inferRoleFromTitle(
  title: string | undefined | null,
): string | undefined {
  if (typeof title !== "string") return undefined;
  for (const role of VILLAGE_ROLES) {
    if (
      title === `village-${role}` ||
      title.startsWith(`village-${role}-`)
    ) {
      return role;
    }
  }
  return undefined;
}

/**
 * Allowed handoff matrix.
 *
 * Key: source role. Value: set of target roles the source may hand off to.
 *
 * | From       | To                          |
 * |------------|-----------------------------|
 * | worker     | guard                       |
 * | guard      | inspector, worker           |
 * | inspector  | worker, mayor, envoy        |
 * | mayor      | worker                      |
 * | envoy      | (none)                      |
 */
export const HANDOFF_MATRIX: Readonly<
  Record<VillageRole, ReadonlySet<VillageRole>>
> = {
  worker: new Set(["guard"]),
  guard: new Set(["inspector", "worker"]),
  inspector: new Set(["worker", "mayor", "envoy"]),
  mayor: new Set(["worker"]),
  envoy: new Set(),
};

/**
 * Check whether a handoff from `from` to `to` is permitted by the matrix.
 */
export function isHandoffAllowed(from: string, to: string): boolean {
  const allowed = HANDOFF_MATRIX[from as VillageRole];
  if (!allowed) return false;
  return allowed.has(to as VillageRole);
}

/**
 * Build the standardized comment header for a handoff.
 *
 * Format: `[handoff <from>-><to>] <note>`
 */
export function formatHandoffComment(
  from: string,
  to: string,
  note: string,
): string {
  return `[handoff ${from}\u2192${to}] ${note}`;
}

/**
 * Create the `village_handoff` tool definition, bound to session helpers.
 */
export function createHandoffTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Atomically hand off a bead to another village role: posts a standardized comment and updates assignee + status in one step.",
    args: {
      bead: tool.schema.string(),
      to: tool.schema.enum([
        "worker",
        "inspector",
        "guard",
        "mayor",
        "envoy",
      ] as const),
      note: tool.schema.string(),
      status: tool.schema.enum(["open", "blocked"] as const).optional(),
    },
    async execute(args, context) {
      const directory = context.directory;

      // Resolve the current actor via fallback chain:
      //   1. Primary: session.agent (existing behavior)
      //   2. Fallback 1: infer role from session.title pattern
      //   3. Fallback 2: walk to session.parentID and read its .agent
      const session = await helpers.getSession(context.sessionID);
      const sessionAgent = (session as any)?.agent as string | undefined;

      let from: string | undefined = sessionAgent ?? undefined;

      // Fallback 1: infer from session title.
      if (!from || !VILLAGE_ROLES.has(from)) {
        const title = (session as any)?.title as string | undefined;
        from = inferRoleFromTitle(title);
      }

      // Fallback 2: walk to parentID and read its agent.
      if (!from || !VILLAGE_ROLES.has(from)) {
        try {
          const parentID = (session as any)?.parentID as string | undefined;
          if (parentID) {
            const parent = await helpers.getSession(parentID);
            const parentAgent = (parent as any)?.agent as string | undefined;
            if (parentAgent && VILLAGE_ROLES.has(parentAgent)) {
              from = parentAgent;
            }
          }
        } catch {
          // Best-effort: network call to parent session may fail.
        }
      }

      if (!from || !VILLAGE_ROLES.has(from)) {
        throw new Error(
          `village_handoff: cannot determine source role (session agent: ${from ?? "unknown"})`,
        );
      }

      // Enforce handoff matrix.
      if (!isHandoffAllowed(from, args.to)) {
        const allowed =
          [...(HANDOFF_MATRIX[from as VillageRole] ?? [])].join(", ") ||
          "(none)";
        throw new Error(
          `village_handoff: ${from} cannot hand off to ${args.to}. Allowed targets: ${allowed}`,
        );
      }

      const status = args.status ?? "open";
      const comment = formatHandoffComment(from, args.to, args.note);

      // Post standardized comment.
      await execFileText("br", ["comments", "add", args.bead, comment], {
        cwd: directory,
        env: { ...process.env, BD_ACTOR: from },
      });

      // Atomically update assignee + status.
      const out = await execBrJson<BrIssue[]>(
        [
          "update",
          args.bead,
          "--assignee",
          args.to,
          "--status",
          status,
          "--json",
        ],
        { cwd: directory, actor: from },
      );

      const updated = Array.isArray(out) ? out[0] : undefined;
      if (!updated) {
        throw new Error(
          `village_handoff: br update returned no result for ${args.bead}`,
        );
      }

      return `handoff ${from}\u2192${args.to}: ${formatIssueLine(updated)}`;
    },
  });
}
