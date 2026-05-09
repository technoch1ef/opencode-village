import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    "- village-workflow",
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
      .replace("- village-workflow", "- (fill in)");
    const result = lintBeadBody(body);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Skills") && e.includes("at least one")),
    ).toBe(true);
  });

  test("fails when skill is not in known skills registry", () => {
    const knownSkills = new Set(["village-workflow"]);
    const body = validBody.replace(
      "- village-workflow",
      "- skill-nonexistent",
    );
    const result = lintBeadBody(body, { knownSkills });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("skill-nonexistent") && e.includes("unknown skill"),
      ),
    ).toBe(true);
  });

  test("passes when all skills are in known registry", () => {
    const knownSkills = new Set([
      "village-workflow",
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
    "- village-workflow",
  ].join("\n");

  test("epic beads skip branch and acceptance criteria checks", () => {
    const result = lintBeadBody(epicBody, { isEpic: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("epic beads still require Context and Skills", () => {
    const body = "## Skills\n\n- village-workflow";
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
    expect(skills.has("village-workflow")).toBe(true);
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
    expect(skills.has("village-workflow")).toBe(true);
  });

  test("picks up skills installed in OPENCODE_CONFIG_DIR via defaultSkillRegistryPaths", async () => {
    const ORIGINAL = process.env.OPENCODE_CONFIG_DIR;
    const tmp = await mkdtemp(join(tmpdir(), "village-lint-"));
    try {
      await mkdir(join(tmp, "skills", "test-skill"), { recursive: true });
      await writeFile(join(tmp, "skills", "test-skill", "SKILL.md"), "# test");
      process.env.OPENCODE_CONFIG_DIR = tmp;
      const skills = await scanSkillRegistry(
        defaultSkillRegistryPaths("/some/unrelated/project"),
      );
      expect(skills.has("test-skill")).toBe(true);
    } finally {
      if (ORIGINAL === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = ORIGINAL;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// --- defaultSkillRegistryPaths ---

describe("defaultSkillRegistryPaths", () => {
  const ORIGINAL_OPENCODE = process.env.OPENCODE_CONFIG_DIR;
  const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (ORIGINAL_OPENCODE === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = ORIGINAL_OPENCODE;
    if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
  });

  test("includes the three project-local paths", () => {
    const paths = defaultSkillRegistryPaths("/foo/bar");
    expect(paths).toContain("/foo/bar/assets/skills");
    expect(paths).toContain("/foo/bar/skills");
    expect(paths).toContain("/foo/bar/skills-private");
  });

  test("includes global config skills paths when OPENCODE_CONFIG_DIR is set", () => {
    process.env.OPENCODE_CONFIG_DIR = "/tmp/fake-opencode";
    const paths = defaultSkillRegistryPaths("/foo/bar");
    expect(paths).toContain("/tmp/fake-opencode/skills");
    expect(paths).toContain("/tmp/fake-opencode/skills-private");
  });

  test("falls back to ~/.config/opencode when OPENCODE_CONFIG_DIR is unset", () => {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    const paths = defaultSkillRegistryPaths("/foo/bar");
    expect(
      paths.some((p) => p.endsWith("/opencode/skills")),
    ).toBe(true);
    expect(
      paths.some((p) => p.endsWith("/opencode/skills-private")),
    ).toBe(true);
  });

  test("de-duplicates entries when project dir equals global config dir", () => {
    process.env.OPENCODE_CONFIG_DIR = "/foo/bar";
    const paths = defaultSkillRegistryPaths("/foo/bar");
    expect(new Set(paths).size).toBe(paths.length);
  });
});
