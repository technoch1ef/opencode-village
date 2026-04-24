import { describe, expect, test } from "bun:test";

import {
  fixShellSnippetNewlines,
  GUARD_WORK_LOOP_PROMPT,
  guardSingleInProgress,
  inferAssigneeFromText,
  INSPECTOR_WORK_LOOP_PROMPT,
  selectDeterministicReady,
  WORKER_WORK_LOOP_PROMPT,
} from "../src/lib/shared";

describe("fixShellSnippetNewlines", () => {
  test("replaces literal \\n separator tokens in shell code fences", () => {
    const input = [
      "```bash",
      "br create foo; \\nbr update bar --status in_progress",
      "```",
      "",
    ].join("\n");

    const out = fixShellSnippetNewlines(input);
    expect(typeof out).toBe("string");
    if (typeof out !== "string") throw new Error("Expected string output");

    expect(out).not.toContain("\\n");
    expect(out).toContain("br create foo;\n");
    expect(out).toContain("br update bar --status in_progress");
  });

  test("is a no-op for non-string inputs", () => {
    expect(fixShellSnippetNewlines(123 as any)).toBe(123);
  });

  test("does not touch non-shell code fences", () => {
    const input = [
      "```json",
      '{"newline": "\\\\n"}',
      "```",
      "",
    ].join("\n");

    const out = fixShellSnippetNewlines(input);
    expect(out).toBe(input);
  });
});

describe("selectDeterministicReady", () => {
  test("selects lowest priority", () => {
    const ready = [
      { id: "a", priority: 2, created_at: "2026-01-01T00:00:00Z" },
      { id: "b", priority: 0, created_at: "2026-12-31T00:00:00Z" },
      { id: "c", priority: 1, created_at: "2026-01-01T00:00:00Z" },
    ];

    const selected = selectDeterministicReady(ready as any);
    expect(selected?.id).toBe("b");
  });

  test("breaks ties by created_at then id", () => {
    const ready = [
      { id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: "a", priority: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: "c", priority: 1, created_at: "2026-01-02T00:00:00Z" },
    ];

    const selected = selectDeterministicReady(ready as any);
    expect(selected?.id).toBe("a");
  });

  test("treats invalid created_at as last", () => {
    const ready = [
      { id: "a", priority: 1, created_at: "not-a-date" },
      { id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" },
    ];

    const selected = selectDeterministicReady(ready as any);
    expect(selected?.id).toBe("b");
  });
});

describe("guardSingleInProgress", () => {
  test("returns none for empty", () => {
    expect(guardSingleInProgress([])).toEqual({ kind: "none" });
  });

  test("returns existing for single", () => {
    const issue = { id: "opencode-1", title: "one" };
    const out = guardSingleInProgress([issue as any]);
    expect(out.kind).toBe("existing");
    if (out.kind !== "existing") throw new Error("Expected existing");
    expect(out.issue.id).toBe("opencode-1");
  });

  test("returns multiple with deterministic ordering", () => {
    const out = guardSingleInProgress([
      { id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" } as any,
      { id: "a", priority: 1, created_at: "2026-01-01T00:00:00Z" } as any,
    ]);

    expect(out.kind).toBe("multiple");
    if (out.kind !== "multiple") throw new Error("Expected multiple");
    expect(out.issues.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("inferAssigneeFromText", () => {
  test("routes review/inspect/scope-like text to inspector", () => {
    expect(inferAssigneeFromText("Please review this")).toBe("inspector");
    expect(inferAssigneeFromText("Inspect the diff for scope issues")).toBe(
      "inspector",
    );
    expect(inferAssigneeFromText("Verify the acceptance criteria")).toBe(
      "inspector",
    );
  });

  test("routes test/lint/build/check-like text to guard", () => {
    expect(inferAssigneeFromText("Run the test suite")).toBe("guard");
    expect(inferAssigneeFromText("Lint and build the project")).toBe("guard");
    expect(inferAssigneeFromText("Run typecheck")).toBe("guard");
  });

  test("defaults to worker", () => {
    expect(inferAssigneeFromText("Implement the feature")).toBe("worker");
  });

  test("inspector keywords take priority over guard keywords", () => {
    // "review" (inspector) appears before "check" (guard)
    expect(inferAssigneeFromText("Review and check the code")).toBe(
      "inspector",
    );
  });
});

describe("work loop prompt invariants", () => {
  test("prompts reference village_claim and do not use br ready as claim path", () => {
    expect(WORKER_WORK_LOOP_PROMPT).toContain("village_claim");
    expect(WORKER_WORK_LOOP_PROMPT).not.toContain("br ready --assignee worker");
    expect(WORKER_WORK_LOOP_PROMPT).not.toContain("--status in_progress");

    expect(INSPECTOR_WORK_LOOP_PROMPT).toContain("village_claim");
    expect(INSPECTOR_WORK_LOOP_PROMPT).not.toContain(
      "br ready --assignee inspector",
    );
    expect(INSPECTOR_WORK_LOOP_PROMPT).not.toContain("--status in_progress");

    expect(GUARD_WORK_LOOP_PROMPT).toContain("village_claim");
    expect(GUARD_WORK_LOOP_PROMPT).not.toContain("br ready --assignee guard");
    expect(GUARD_WORK_LOOP_PROMPT).not.toContain("--status in_progress");
  });

  test("worker prompt uses village_handoff instead of two-step", () => {
    expect(WORKER_WORK_LOOP_PROMPT).toContain("village_handoff");
    expect(WORKER_WORK_LOOP_PROMPT).not.toContain("br comments add");
    expect(WORKER_WORK_LOOP_PROMPT).not.toContain("--assignee inspector");
  });

  test("worker prompt references village_ensure_branch for branch management", () => {
    expect(WORKER_WORK_LOOP_PROMPT).toContain("village_ensure_branch");
    expect(WORKER_WORK_LOOP_PROMPT).toContain("village_claim");
    // Step 4 should mention that village_claim handles branch setup.
    expect(WORKER_WORK_LOOP_PROMPT).toContain("placed you on the bead's branch");
  });

  test("inspector prompt references village_handoff to guard", () => {
    expect(INSPECTOR_WORK_LOOP_PROMPT).toContain("village_handoff");
    expect(INSPECTOR_WORK_LOOP_PROMPT).toContain("guard");
  });

  test("guard prompt can close beads on green checks", () => {
    expect(GUARD_WORK_LOOP_PROMPT).toContain("br close");
    expect(GUARD_WORK_LOOP_PROMPT).toContain("Approved");
  });
});
