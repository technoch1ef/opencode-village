import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { detectStack, findRepoRoot, mergeSkills } from "../src/detect/stack";
import {
  injectSkillsIntoBody,
  parseSkillsFromBody,
} from "../src/tools/scaffold";

const FIXTURES = resolve(import.meta.dir, "fixtures/detect-stack");

describe("detectStack", () => {
  test("detects stack-typescript from package.json", async () => {
    const skills = await detectStack(resolve(FIXTURES, "typescript"));
    expect(skills).toContain("beads-workflow");
    expect(skills).toContain("stack-typescript");
  });

  test("detects stack-solana from Anchor.toml", async () => {
    const skills = await detectStack(resolve(FIXTURES, "solana-anchor"));
    expect(skills).toContain("beads-workflow");
    expect(skills).toContain("stack-solana");
  });

  test("detects stack-solana from programs/*/Cargo.toml", async () => {
    const skills = await detectStack(resolve(FIXTURES, "solana-programs"));
    expect(skills).toContain("beads-workflow");
    expect(skills).toContain("stack-solana");
  });

  test("detects stack-ruby-on-rails from Gemfile with rails", async () => {
    const skills = await detectStack(resolve(FIXTURES, "rails"));
    expect(skills).toContain("beads-workflow");
    expect(skills).toContain("stack-ruby-on-rails");
  });

  test("returns only beads-workflow for empty directory", async () => {
    const skills = await detectStack(resolve(FIXTURES, "empty"));
    expect(skills).toEqual(["beads-workflow"]);
  });

  test("detects multiple stacks in multi-stack project", async () => {
    const skills = await detectStack(resolve(FIXTURES, "multi-stack"));
    expect(skills).toContain("beads-workflow");
    expect(skills).toContain("stack-typescript");
    expect(skills).toContain("stack-solana");
  });

  test("always has beads-workflow as first element", async () => {
    const skills = await detectStack(resolve(FIXTURES, "typescript"));
    expect(skills[0]).toBe("beads-workflow");
  });

  test("returns deduplicated results", async () => {
    const skills = await detectStack(resolve(FIXTURES, "multi-stack"));
    const unique = new Set(skills);
    expect(skills.length).toBe(unique.size);
  });

  test("remaining skills are sorted alphabetically", async () => {
    const skills = await detectStack(resolve(FIXTURES, "multi-stack"));
    // Remove beads-workflow (always first), then check sorting.
    const rest = skills.slice(1);
    const sorted = [...rest].sort();
    expect(rest).toEqual(sorted);
  });
});

describe("detectStack monorepo support", () => {
  test("detects skills from packages/* subdirectories", async () => {
    // The monorepo fixture has:
    // - root: package.json (stack-typescript)
    // - packages/web: package.json (stack-typescript, deduped)
    // - packages/api: Gemfile with rails (stack-ruby-on-rails)
    const skills = await detectStack(resolve(FIXTURES, "monorepo"));
    expect(skills).toContain("beads-workflow");
    expect(skills).toContain("stack-typescript");
    expect(skills).toContain("stack-ruby-on-rails");
    expect(skills[0]).toBe("beads-workflow");
  });
});

describe("findRepoRoot", () => {
  test("stops at fixture directory with .git marker file", async () => {
    const tsFixture = resolve(FIXTURES, "typescript");
    const root = await findRepoRoot(tsFixture);
    // The typescript fixture has a .git file, so findRepoRoot should stop there.
    expect(root).toBe(tsFixture);
  });

  test("returns start directory when no .git found", async () => {
    // /tmp should not have a .git file or directory
    const root = await findRepoRoot("/tmp");
    expect(root).toBe("/tmp");
  });
});

describe("mergeSkills", () => {
  test("deduplicates and sorts", () => {
    const result = mergeSkills(
      ["stack-typescript", "beads-workflow"],
      ["beads-workflow", "stack-solana", "stack-typescript"],
    );
    expect(result).toEqual([
      "beads-workflow",
      "stack-solana",
      "stack-typescript",
    ]);
  });

  test("always starts with beads-workflow", () => {
    const result = mergeSkills(["stack-typescript"], ["stack-solana"]);
    expect(result[0]).toBe("beads-workflow");
  });

  test("handles empty inputs", () => {
    const result = mergeSkills([], []);
    expect(result).toEqual(["beads-workflow"]);
  });

  test("filters empty strings", () => {
    const result = mergeSkills(["", "stack-typescript"], ["", ""]);
    expect(result).toEqual(["beads-workflow", "stack-typescript"]);
  });
});

describe("parseSkillsFromBody", () => {
  test("extracts skill names from ## Skills section", () => {
    const body = [
      "## Context",
      "",
      "Some context",
      "",
      "## Skills",
      "",
      "- beads-workflow",
      "- stack-typescript",
      "",
      "## Branch",
      "",
      "`epic/test`",
    ].join("\n");

    const skills = parseSkillsFromBody(body);
    expect(skills).toEqual(["beads-workflow", "stack-typescript"]);
  });

  test("returns empty array when no ## Skills section", () => {
    const body = "## Context\n\nSome text";
    expect(parseSkillsFromBody(body)).toEqual([]);
  });

  test("ignores placeholder entries", () => {
    const body = "## Skills\n\n- (fill in)\n\n## Branch";
    expect(parseSkillsFromBody(body)).toEqual([]);
  });
});

describe("injectSkillsIntoBody", () => {
  test("replaces existing ## Skills section", () => {
    const body = [
      "## Context",
      "",
      "Some context",
      "",
      "## Skills",
      "",
      "- beads-workflow",
      "",
      "## Branch",
      "",
      "`epic/test`",
    ].join("\n");

    const result = injectSkillsIntoBody(body, [
      "beads-workflow",
      "stack-typescript",
    ]);
    expect(result).toContain("- beads-workflow");
    expect(result).toContain("- stack-typescript");
    expect(result).toContain("## Context");
    expect(result).toContain("## Branch");
  });

  test("injects ## Skills section when missing", () => {
    const body = [
      "## Context",
      "",
      "Some context",
      "",
      "## Branch",
      "",
      "`epic/test`",
    ].join("\n");

    const result = injectSkillsIntoBody(body, [
      "beads-workflow",
      "stack-solana",
    ]);
    expect(result).toContain("## Skills");
    expect(result).toContain("- beads-workflow");
    expect(result).toContain("- stack-solana");
  });

  test("preserves other sections when replacing", () => {
    const body = [
      "## Context",
      "",
      "Build the widget",
      "",
      "## Skills",
      "",
      "- old-skill",
      "",
      "## Branch",
      "",
      "`epic/widgets`",
      "",
      "## Notes",
      "",
      "Important note",
    ].join("\n");

    const result = injectSkillsIntoBody(body, ["beads-workflow", "stack-typescript"]);
    expect(result).toContain("Build the widget");
    expect(result).toContain("`epic/widgets`");
    expect(result).toContain("Important note");
    expect(result).not.toContain("old-skill");
  });
});
