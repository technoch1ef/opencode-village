/**
 * Bead body linter — validates structured bead descriptions.
 *
 * Rejects incomplete beads at creation time so workers never claim
 * under-specified work.
 *
 * @module
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Result of linting a bead body.
 */
export type LintResult = {
  /** `true` when the body passes all checks. */
  ok: boolean;
  /** Human-readable, actionable error messages (empty when ok). */
  errors: string[];
};

/**
 * Options for `lintBeadBody`.
 */
export type LintOptions = {
  /** When true, skip acceptance-criteria and branch checks (for epics). */
  isEpic?: boolean;
  /** Set of known valid skill names. When provided, skills are validated against it. */
  knownSkills?: Set<string>;
};

/**
 * Branch name pattern: lowercase alphanumeric, slashes, underscores, hyphens.
 */
const BRANCH_PATTERN = /^[a-z0-9/_-]+$/;

/**
 * Extract a named `## Section` from a markdown body.
 * Returns the content between the header and the next `## ` or end-of-string.
 * Returns `null` if the section doesn't exist.
 *
 * Uses line-by-line scanning (not regex) to avoid multiline `$` anchor bugs.
 */
function extractSection(body: string, sectionName: string): string | null {
  const lines = body.split("\n");
  const header = `## ${sectionName}`;
  const idx = lines.findIndex(
    (l) => l.trimEnd() === header || l.trimEnd().startsWith(`${header} `),
  );
  if (idx === -1) return null;

  const contentLines: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    contentLines.push(lines[i]);
  }
  return contentLines.join("\n");
}

/**
 * Lint a bead body for required sections and content.
 *
 * Required sections for non-epic beads:
 * - `## Context` — non-empty, not `(fill in)`
 * - `## Skills` — ≥1 skill, each must exist in skills registry (if provided)
 * - `## Branch` — matches `^[a-z0-9/_-]+$`
 * - `## Acceptance Criteria` — ≥1 `- [ ]` checkbox
 *
 * Epic beads are exempt from acceptance-criteria and branch checks.
 */
export function lintBeadBody(body: string, opts?: LintOptions): LintResult {
  const errors: string[] = [];
  const isEpic = opts?.isEpic ?? false;
  const knownSkills = opts?.knownSkills;

  // --- ## Context ---
  const contextContent = extractSection(body, "Context");
  if (contextContent === null) {
    errors.push("missing required section: ## Context");
  } else {
    const trimmed = contextContent.trim();
    if (!trimmed || trimmed === "(fill in)") {
      errors.push(
        "## Context must have meaningful content (not empty or placeholder)",
      );
    }
  }

  // --- ## Skills ---
  const skillsContent = extractSection(body, "Skills");
  if (skillsContent === null) {
    errors.push("missing required section: ## Skills");
  } else {
    const skills = parseSkillList(skillsContent);
    if (skills.length === 0) {
      errors.push("## Skills must list at least one skill (e.g. `- village-workflow`)");
    } else if (knownSkills) {
      for (const skill of skills) {
        if (!knownSkills.has(skill)) {
          errors.push(
            `unknown skill in ## Skills: "${skill}" — not found in skills registry`,
          );
        }
      }
    }
  }

  // --- ## Branch (skip for epics) ---
  if (!isEpic) {
    const branchContent = extractSection(body, "Branch");
    if (branchContent === null) {
      errors.push("missing required section: ## Branch");
    } else {
      const branchName = parseBranchName(branchContent);
      if (!branchName) {
        errors.push(
          "## Branch must contain a branch name (plain or backtick-quoted)",
        );
      } else if (!BRANCH_PATTERN.test(branchName)) {
        errors.push(
          `## Branch name "${branchName}" contains invalid characters — must match [a-z0-9/_-]+`,
        );
      }
    }
  }

  // --- ## Acceptance Criteria (skip for epics) ---
  if (!isEpic) {
    const acContent = extractSection(body, "Acceptance Criteria");
    if (acContent === null) {
      errors.push("missing required section: ## Acceptance Criteria");
    } else {
      const checkboxes = acContent.match(/^-\s+\[ \]/gm);
      if (!checkboxes || checkboxes.length === 0) {
        errors.push(
          "## Acceptance Criteria must contain at least one checkbox (- [ ] ...)",
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Parse skill names from a skills section content.
 * Expects lines like `- skill-name`. Ignores placeholders like `- (fill in)`.
 */
function parseSkillList(content: string): string[] {
  const skills: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
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
 * Parse a branch name from the branch section content.
 * Supports both backtick-quoted (`epic/foo`) and plain (epic/foo) formats.
 */
function parseBranchName(content: string): string | null {
  const trimmed = content.trim();
  // Backtick-quoted
  const backtickMatch = trimmed.match(/`([^`]+)`/);
  if (backtickMatch) return backtickMatch[1].trim() || null;
  // Plain: take the first non-empty line
  const firstLine = trimmed.split("\n")[0]?.trim();
  return firstLine || null;
}

/**
 * Scan filesystem directories for skill names.
 *
 * Checks each directory for subdirectories (each subdirectory name = a skill name).
 * Directories that don't exist are silently skipped.
 *
 * @param dirs - Array of directory paths to scan
 * @returns Set of skill names found across all directories
 */
export async function scanSkillRegistry(dirs: string[]): Promise<Set<string>> {
  const skills = new Set<string>();

  for (const dir of dirs) {
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          skills.add(entry.name);
        }
      }
    } catch {
      // Ignore permission errors etc.
    }
  }

  return skills;
}

/**
 * Build the default skill registry paths for the OpenCode config directory.
 */
export function defaultSkillRegistryPaths(configDir: string): string[] {
  return [
    join(configDir, "assets", "skills"),
    join(configDir, "skills"),
    join(configDir, "skills-private"),
  ];
}
