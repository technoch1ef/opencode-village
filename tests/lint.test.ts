import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  defaultSkillRegistryPaths,
  lintBeadBody,
  scanSkillRegistry,
} from "../src/lib/lint";

// --- lintBeadBody ---

describe("lintBeadBody", () => {
  const validBody = [
    "## Context",
    "",
    "Build a new widget for the dashboard.",
    "",
    "## Skills",
    "",
    "- beads-workflow",
    "- stack-typescript",
    "",
    "## Branch",
    "",
    "`epic/widgets`",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] Widget renders correctly",
    "- [ ] Tests pass",
    "",
    "## Notes",
    "",
    "(none)",
  ].join("\n");

  test("passes for a valid bead body", () => {
    const result = lintBeadBody(validBody);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("fails when ## Context is missing", () => {
    const body = validBody.replace(/## Context[\s\S]*?(?=\n## Skills)/, "");
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("## Context"))).toBe(true);
  });

  test("fails when ## Context is placeholder", () => {
    const body = validBody.replace(
      "Build a new widget for the dashboard.",
      "(fill in)",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Context") && e.includes("meaningful")),
    ).toBe(true);
  });

  test("fails when ## Context is empty", () => {
    const body = validBody.replace(
      "Build a new widget for the dashboard.",
      "",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Context") && e.includes("meaningful")),
    ).toBe(true);
  });

  test("fails when ## Skills is missing", () => {
    const body = validBody.replace(
      /## Skills[\s\S]*?(?=\n## Branch)/,
      "",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("## Skills"))).toBe(true);
  });

  test("fails when ## Skills has no entries", () => {
    const body = validBody
      .replace("- beads-workflow\n- stack-typescript", "- (fill in)");
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Skills") && e.includes("at least one")),
    ).toBe(true);
  });

  test("fails when skill is not in known skills registry", () => {
    const knownSkills = new Set(["beads-workflow", "stack-typescript"]);
    const body = validBody.replace(
      "- stack-typescript",
      "- stack-nonexistent",
    );
    const result = lintBeadBody(body, { knownSkills });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("stack-nonexistent") && e.includes("unknown skill"),
      ),
    ).toBe(true);
  });

  test("passes when all skills are in known registry", () => {
    const knownSkills = new Set([
      "beads-workflow",
      "stack-typescript",
    ]);
    const result = lintBeadBody(validBody, { knownSkills });
    expect(result.ok).toBe(true);
  });

  test("fails when ## Branch is missing", () => {
    const body = validBody.replace(
      /## Branch[\s\S]*?(?=\n## Acceptance)/,
      "",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("## Branch"))).toBe(true);
  });

  test("fails when branch name has invalid characters", () => {
    const body = validBody.replace("`epic/widgets`", "`Epic/Widgets 123`");
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("Branch") && e.includes("invalid characters"),
      ),
    ).toBe(true);
  });

  test("accepts valid branch with slashes, hyphens, underscores", () => {
    const body = validBody.replace(
      "`epic/widgets`",
      "`feature/my-branch_v2`",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(true);
  });

  test("fails when ## Acceptance Criteria is missing", () => {
    const body = validBody.replace(
      /## Acceptance Criteria[\s\S]*?(?=\n## Notes)/,
      "",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("## Acceptance Criteria")),
    ).toBe(true);
  });

  test("fails when ## Acceptance Criteria has no checkboxes", () => {
    const body = validBody.replace(
      "- [ ] Widget renders correctly\n- [ ] Tests pass",
      "Just some text about criteria",
    );
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("Acceptance Criteria") && e.includes("checkbox"),
      ),
    ).toBe(true);
  });

  test("collects multiple errors at once", () => {
    // Body with no sections at all
    const body = "This is just plain text with no structure.";
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    // Should have errors for Context, Skills, Branch, and Acceptance Criteria
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("lintBeadBody epic exemptions", () => {
  const epicBody = [
    "## Context",
    "",
    "Epic overview for the project.",
    "",
    "## Skills",
    "",
    "- beads-workflow",
  ].join("\n");

  test("epic beads skip branch and acceptance criteria checks", () => {
    const result = lintBeadBody(epicBody, { isEpic: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("epic beads still require Context and Skills", () => {
    const body = "## Skills\n\n- beads-workflow";
    const result = lintBeadBody(body, { isEpic: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("## Context"))).toBe(true);
  });

  test("non-epic beads require branch and acceptance criteria", () => {
    const result = lintBeadBody(epicBody, { isEpic: false });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("## Branch"))).toBe(true);
    expect(
      result.errors.some((e) => e.includes("## Acceptance Criteria")),
    ).toBe(true);
  });
});

describe("lintBeadBody error messages are human-readable", () => {
  test("errors are actionable, not schema-style", () => {
    const body = "no sections here";
    const result = lintBeadBody(body);
    for (const err of result.errors) {
      expect(err).not.toContain("schema");
      expect(err).not.toContain("$.body");
      // Each error should mention the section name
      expect(err).toMatch(/## (Context|Skills|Branch|Acceptance Criteria)/);
    }
  });
});

// --- scanSkillRegistry ---

describe("scanSkillRegistry", () => {
  test("scans directories for skill subdirectories", async () => {
    // Use the repo's bundled assets/skills/ directory (always present in git)
    const configDir = resolve(import.meta.dir, "..");
    const skills = await scanSkillRegistry([resolve(configDir, "assets", "skills")]);
    expect(skills.has("beads-workflow")).toBe(true);
    expect(skills.has("stack-typescript")).toBe(true);
  });

  test("silently skips non-existent directories", async () => {
    const skills = await scanSkillRegistry(["/nonexistent/path/skills"]);
    expect(skills.size).toBe(0);
  });

  test("merges skills from multiple directories", async () => {
    const configDir = resolve(import.meta.dir, "..");
    const skills = await scanSkillRegistry([
      resolve(configDir, "assets", "skills"),
      resolve(configDir, "skills"),
    ]);
    // Should have skills from bundled assets dir (skills/ may not exist in a fresh checkout)
    expect(skills.has("beads-workflow")).toBe(true);
    expect(skills.has("stack-typescript")).toBe(true);
  });
});

// --- defaultSkillRegistryPaths ---

describe("defaultSkillRegistryPaths", () => {
  test("returns three paths relative to config dir", () => {
    const paths = defaultSkillRegistryPaths("/foo/bar");
    expect(paths).toEqual([
      "/foo/bar/assets/skills",
      "/foo/bar/skills",
      "/foo/bar/skills-private",
    ]);
  });
});
