/**
 * `village_orphans` tool — report and optionally fix unassigned beads.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson, formatOrphansRow } from "../lib/br";
import type { SessionHelpers } from "../lib/sessions";
import {
  compareBrIssuesDeterministic,
  inferAssigneeFromText,
  VALID_ASSIGNEES,
  type BrIssue,
} from "../lib/shared";

/**
 * Create the `village_orphans` tool definition, bound to session helpers.
 */
export function createOrphansTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Report orphan/suspect-assignee beads (open + in_progress) and optionally fix unassigned non-epics.",
    args: {
      fix: tool.schema.boolean().optional(),
      limit: tool.schema.number().int().min(1).max(200).optional(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const actor = await helpers.resolveActor(context.sessionID);

      let openIssues: BrIssue[] = [];
      let inProgressIssues: BrIssue[] = [];
      try {
        openIssues = await execBrJson<BrIssue[]>(
          ["list", "--status", "open", "--json"],
          { cwd: directory, actor },
        );
        inProgressIssues = await execBrJson<BrIssue[]>(
          ["list", "--status", "in_progress", "--json"],
          { cwd: directory, actor },
        );
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (
          msg.toLowerCase().includes("enoent") &&
          msg.toLowerCase().includes("br")
        ) {
          return "br not available; cannot inspect beads.";
        }
        if (
          msg.includes(".beads") &&
          msg.toLowerCase().includes("missing")
        ) {
          return "No .beads database found; nothing to inspect.";
        }
        throw err;
      }

      const combined = new Map<string, BrIssue>();
      for (const i of [...openIssues, ...inProgressIssues]) {
        if (i?.id) combined.set(i.id, i);
      }

      const all = [...combined.values()].sort(compareBrIssuesDeterministic);

      const ignoredEpics: BrIssue[] = [];
      const scannedNonEpic: BrIssue[] = [];
      for (const issue of all) {
        if (issue.issue_type === "epic") ignoredEpics.push(issue);
        else scannedNonEpic.push(issue);
      }

      const orphans: BrIssue[] = [];
      const suspect: BrIssue[] = [];
      for (const issue of scannedNonEpic) {
        const a = (issue.assignee ?? "").trim();
        if (!a) orphans.push(issue);
        else if (!VALID_ASSIGNEES.has(a)) suspect.push(issue);
      }

      const ignoredEpicsUnassigned = ignoredEpics.filter(
        (i) => !(i.assignee ?? "").trim(),
      );
      const ignoredEpicsSuspect = ignoredEpics.filter((i) => {
        const a = (i.assignee ?? "").trim();
        return a && !VALID_ASSIGNEES.has(a);
      });

      const limit = args.limit ?? 20;
      const rows = [...orphans, ...suspect]
        .slice()
        .sort(compareBrIssuesDeterministic)
        .slice(0, limit)
        .map(formatOrphansRow);

      const lines: string[] = [];
      lines.push(
        `Scanned (non-epic): ${scannedNonEpic.length} | Ignored epics: ${ignoredEpics.length} | Ignored epics (unassigned): ${ignoredEpicsUnassigned.length} | Orphans: ${orphans.length} | Suspect: ${suspect.length}`,
      );

      if (rows.length) {
        lines.push("id | title | status | assignee");
        for (const r of rows) lines.push(r);
      } else {
        lines.push("No orphan/suspect non-epic beads found.");
      }

      const ignoredAttention = new Map<
        string,
        { issue: BrIssue; reason: string }
      >();
      for (const i of ignoredEpicsUnassigned)
        ignoredAttention.set(i.id, { issue: i, reason: "unassigned" });
      for (const i of ignoredEpicsSuspect)
        ignoredAttention.set(i.id, {
          issue: i,
          reason: "suspect assignee",
        });

      if (ignoredAttention.size) {
        lines.push("Ignored epics:");
        const epicRows = [...ignoredAttention.values()]
          .map((v) => v)
          .sort((a, b) => compareBrIssuesDeterministic(a.issue, b.issue))
          .slice(0, 5)
          .map(({ issue, reason }) => {
            const base = formatOrphansRow(issue);
            return `${base} | ${reason}`;
          });
        for (const r of epicRows) lines.push(r);
      }

      if (!args.fix) return lines.join("\n");

      const changed: string[] = [];
      const toFix = orphans.slice().sort(compareBrIssuesDeterministic);
      for (const issue of toFix) {
        const text = `${issue.title ?? ""}\n${issue.description ?? ""}\n${issue.notes ?? ""}`;
        const target = inferAssigneeFromText(text);
        await execBrJson<BrIssue[]>(
          ["update", issue.id, "--assignee", target, "--json"],
          { cwd: directory, actor },
        );
        changed.push(`${issue.id} -> ${target}`);
      }

      lines.push(`Fix mode: updated ${changed.length} orphan(s)`);
      if (changed.length) {
        for (const c of changed) lines.push(`- ${c}`);
      }
      return lines.join("\n");
    },
  });
}
