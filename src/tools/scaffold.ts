/**
 * `village_scaffold` tool — create an epic and child beads deterministically.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { detectStack, mergeSkills } from "../detect/stack";
import { execBrJson, firstBrIssue } from "../lib/br";
import {
  defaultSkillRegistryPaths,
  lintBeadBody,
  scanSkillRegistry,
} from "../lib/lint";
import type { SessionHelpers } from "../lib/sessions";
import type { BrIssue } from "../lib/shared";

/**
 * Detect if a body string already contains structured markdown sections
 * (e.g. `## Context`, `## Skills`). When true, the body should be used
 * directly as the bead description — no wrapping via `renderScaffoldDescription`.
 */
export function isStructuredBody(body: string | undefined): boolean {
  if (!body) return false;
  return /^## (Context|Skills)/m.test(body);
}

/**
 * Parse skill names from a `## Skills` markdown section.
 *
 * Uses line-by-line scanning (not regex) to avoid multiline `$` anchor bugs.
 * Collects `- skill-name` entries between `## Skills` and the next `##` header.
 */
export function parseSkillsFromBody(body: string): string[] {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => /^## Skills\s*$/.test(l));
  if (idx === -1) return [];

  const skills: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("- ")) {
      const skill = trimmed.slice(2).trim();
      if (skill && !skill.startsWith("(")) {
        skills.push(skill);
      }
    }
  }
  return skills;
}

/**
 * Replace (or inject) the `## Skills` section in a structured body with merged skills.
 *
 * Uses line-by-line scanning (not regex) to avoid multiline `$` anchor bugs.
 */
export function injectSkillsIntoBody(body: string, skills: string[]): string {
  const skillBlock = skills.map((s) => `- ${s}`).join("\n");
  const lines = body.split("\n");

  const startIdx = lines.findIndex((l) => /^## Skills\s*$/.test(l));

  if (startIdx !== -1) {
    // Find end of Skills section (next ## header or end of body).
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        endIdx = i;
        break;
      }
    }

    const before = lines.slice(0, startIdx);
    const after = lines.slice(endIdx);
    return [...before, "## Skills", "", skillBlock, "", ...after].join("\n");
  }

  // No ## Skills section — inject after ## Context (or at top if no Context).
  const contextIdx = lines.findIndex((l) => /^## Context/.test(l));
  if (contextIdx !== -1) {
    // Find end of Context section.
    let contextEnd = lines.length;
    for (let i = contextIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        contextEnd = i;
        break;
      }
    }

    const before = lines.slice(0, contextEnd);
    const after = lines.slice(contextEnd);
    return [...before, "", "## Skills", "", skillBlock, "", ...after].join(
      "\n",
    );
  }

  // Fallback: prepend.
  return `## Skills\n\n${skillBlock}\n\n${body}`;
}

/**
 * Render a bead description with the standard section layout.
 */
export function renderScaffoldDescription(args: {
  context?: string;
  branch: string;
  skills: string[];
  acceptance?: string;
  notes?: string;
}): string {
  const skills = args.skills.filter(Boolean);

  const lines: string[] = [];
  lines.push("## Context", "", (args.context ?? "").trim() || "(fill in)", "");
  lines.push("## Skills", "");
  if (skills.length) {
    for (const s of skills) lines.push(`- ${s}`);
  } else {
    lines.push("- (fill in)");
  }
  lines.push("");

  lines.push("## Branch", "", `\`${args.branch}\``, "");

  lines.push("## Acceptance Criteria", "");
  const acceptance = (args.acceptance ?? "").trim();
  if (acceptance) {
    lines.push(acceptance);
  } else {
    lines.push("- [ ] (fill in)");
  }
  lines.push("");

  lines.push("## Notes", "", (args.notes ?? "").trim() || "(none)");

  return lines.join("\n");
}

/**
 * Create the `village_scaffold` tool definition, bound to session helpers.
 */
export function createScaffoldTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Deterministically create an epic and child beads with correct assignees and parent/child linkage.",
    args: {
      epic_title: tool.schema.string(),
      epic_body: tool.schema.string().optional(),
      branch: tool.schema.string(),
      epic_priority: tool.schema.number().int().min(0).max(4).optional(),
      children: tool.schema
        .array(
          tool.schema.object({
            title: tool.schema.string(),
            type: tool.schema.enum([
              "task",
              "bug",
              "feature",
              "chore",
            ] as const),
            priority: tool.schema.number().int().min(0).max(4),
            assignee: tool.schema.enum(["worker", "inspector", "guard"] as const),
            body: tool.schema.string().optional(),
          }),
        )
        .optional(),
      dry_run: tool.schema.boolean().optional(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const actor = await helpers.resolveActor(context.sessionID);

      const branch = args.branch.trim();
      if (!branch) throw new Error("branch is required");

      // Auto-detect stack skills from the target directory.
      const detectedSkills = await detectStack(directory);

      const epicDescription = isStructuredBody(args.epic_body)
        ? injectSkillsIntoBody(
            args.epic_body!.trim(),
            mergeSkills(parseSkillsFromBody(args.epic_body!), detectedSkills),
          )
        : renderScaffoldDescription({
            context: args.epic_body,
            branch,
            skills: detectedSkills,
          });

      const children = args.children ?? [];
      for (const c of children) {
        if (
          c.assignee !== "worker" &&
          c.assignee !== "inspector" &&
          c.assignee !== "guard"
        ) {
          throw new Error(
            `Invalid child assignee: ${String(c.assignee)} (must be worker|inspector|guard)`,
          );
        }
      }

      const planLines: string[] = [];
      planLines.push(
        `Epic: ${args.epic_title} (priority ${args.epic_priority ?? 2})`,
      );
      for (const c of children) {
        planLines.push(
          `Child: ${c.title} | type=${c.type} | priority=${c.priority} | assignee=${c.assignee}`,
        );
      }

      if (args.dry_run) {
        return ["dry_run: true", ...planLines].join("\n");
      }

      // Scan the skills registry for validation.
      const registryPaths = defaultSkillRegistryPaths(directory);
      const knownSkills = await scanSkillRegistry(registryPaths);

      // Pre-render all child descriptions and lint them before creating anything.
      const childDescriptions: string[] = [];
      const lintErrors: string[] = [];

      for (const c of children) {
        const childDescription = isStructuredBody(c.body)
          ? injectSkillsIntoBody(
              c.body!.trim(),
              mergeSkills(parseSkillsFromBody(c.body!), detectedSkills),
            )
          : renderScaffoldDescription({
              context: c.body,
              branch,
              skills: detectedSkills,
            });
        childDescriptions.push(childDescription);

        // Children of a scaffold are never epics (only the parent is).
        const lint = lintBeadBody(childDescription, { isEpic: false, knownSkills });
        if (!lint.ok) {
          lintErrors.push(
            `Child "${c.title}":\n${lint.errors.map((e) => `  - ${e}`).join("\n")}`,
          );
        }
      }

      if (lintErrors.length > 0) {
        throw new Error(
          `village_scaffold rejected: ${lintErrors.length} child bead(s) failed validation:\n\n` +
            lintErrors.join("\n\n"),
        );
      }

      const createdIDs: string[] = [];
      let epicID: string | undefined;

      try {
        const epicOut = await execBrJson<BrIssue | BrIssue[]>(
          [
            "create",
            args.epic_title,
            "--type",
            "epic",
            "--priority",
            String(args.epic_priority ?? 2),
            "--description",
            epicDescription,
            "--json",
          ],
          { cwd: directory, actor },
        );

        const epic = firstBrIssue(epicOut);
        epicID = epic?.id;
        if (!epicID) throw new Error("br create epic returned no id");
        createdIDs.push(epicID);

        const childRows: string[] = [];
        for (let i = 0; i < children.length; i++) {
          const c = children[i];
          const childDescription = childDescriptions[i];

          const out = await execBrJson<BrIssue | BrIssue[]>(
            [
              "create",
              c.title,
              "--type",
              c.type,
              "--priority",
              String(c.priority),
              "--assignee",
              c.assignee,
              "--description",
              childDescription,
              "--parent",
              epicID,
              "--json",
            ],
            { cwd: directory, actor },
          );
          const child = firstBrIssue(out);
          if (!child?.id)
            throw new Error(`br create child returned no id for: ${c.title}`);
          createdIDs.push(child.id);
          childRows.push(
            `${child.id} | ${c.title.replace(/\s+/g, " ").trim()} | ${c.assignee} | ${c.type} | ${c.priority}`,
          );
        }

        const lines: string[] = [];
        lines.push(
          `Created epic: ${epicID} | ${args.epic_title.replace(/\s+/g, " ").trim()}`,
        );
        if (childRows.length) {
          lines.push("Created children:");
          for (const r of childRows) lines.push(`- ${r}`);
        } else {
          lines.push("Created children: (none)");
        }
        return lines.join("\n");
      } catch (err: any) {
        const created = createdIDs.length ? createdIDs.join(", ") : "(none)";
        throw new Error(
          `village_scaffold failed; partial creation possible. Created IDs: ${created}\n` +
            String(err?.message ?? err),
        );
      }
    },
  });
}
