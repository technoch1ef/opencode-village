import { describe, expect, test } from "bun:test";

import {
  isStructuredBody,
  renderScaffoldDescription,
} from "../src/tools/scaffold";

describe("isStructuredBody", () => {
  test("detects ## Context header", () => {
    expect(isStructuredBody("## Context\n\nSome text")).toBe(true);
  });

  test("detects ## Skills header", () => {
    expect(isStructuredBody("## Skills\n- beads-workflow")).toBe(true);
  });

  test("returns false for plain text", () => {
    expect(isStructuredBody("Just a plain description")).toBe(false);
  });

  test("returns false for undefined/empty", () => {
    expect(isStructuredBody(undefined)).toBe(false);
    expect(isStructuredBody("")).toBe(false);
  });

  test("detects headers not at start of string", () => {
    expect(isStructuredBody("Some preamble\n## Context\n\nText")).toBe(true);
  });
});

describe("renderScaffoldDescription", () => {
  test("renders all sections with provided values", () => {
    const result = renderScaffoldDescription({
      context: "Build the widget",
      branch: "epic/widgets",
      skills: ["beads-workflow", "stack-typescript"],
      acceptance: "- [ ] Widget works",
      notes: "None",
    });

    expect(result).toContain("## Context");
    expect(result).toContain("Build the widget");
    expect(result).toContain("## Skills");
    expect(result).toContain("- beads-workflow");
    expect(result).toContain("- stack-typescript");
    expect(result).toContain("## Branch");
    expect(result).toContain("`epic/widgets`");
    expect(result).toContain("## Acceptance Criteria");
    expect(result).toContain("- [ ] Widget works");
    expect(result).toContain("## Notes");
    expect(result).toContain("None");
  });

  test("uses defaults for missing fields", () => {
    const result = renderScaffoldDescription({
      branch: "epic/test",
      skills: [],
    });

    expect(result).toContain("(fill in)");
    expect(result).toContain("- (fill in)"); // skills placeholder
    expect(result).toContain("- [ ] (fill in)"); // acceptance placeholder
    expect(result).toContain("(none)"); // notes placeholder
  });

  test("filters out empty skill names", () => {
    const result = renderScaffoldDescription({
      branch: "epic/test",
      skills: ["", "beads-workflow", ""],
    });

    expect(result).toContain("- beads-workflow");
    // Should only have one skill bullet
    const skillLines = result
      .split("\n")
      .filter((l) => l.startsWith("- ") && !l.includes("[ ]"));
    expect(skillLines).toEqual(["- beads-workflow"]);
  });
});
