import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import {
  WORKTREE_PREFIX,
  checkWorktreeConflict,
  formatWorktreeComment,
  getWorktreeFromBead,
  getWorktreeMapping,
  parseWorktreeFromComment,
  resolveWorktreePath,
  type WorktreeConflict,
  type WorktreeEntry,
} from "../src/lib/worktree";

// ---------------------------------------------------------------------------
// Pure functions — no I/O
// ---------------------------------------------------------------------------

describe("formatWorktreeComment", () => {
  test("returns prefix + absolute path", () => {
    expect(formatWorktreeComment("/Users/me/project")).toBe(
      "[village] worktree: /Users/me/project",
    );
  });

  test("handles paths with spaces", () => {
    expect(formatWorktreeComment("/Users/me/my project")).toBe(
      "[village] worktree: /Users/me/my project",
    );
  });
});

describe("parseWorktreeFromComment", () => {
  test("parses a valid worktree comment", () => {
    expect(
      parseWorktreeFromComment("[village] worktree: /Users/me/project"),
    ).toBe("/Users/me/project");
  });

  test("returns null for non-worktree comments", () => {
    expect(parseWorktreeFromComment("some random comment")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseWorktreeFromComment("")).toBeNull();
  });

  test("returns null for prefix with no path", () => {
    expect(parseWorktreeFromComment("[village] worktree: ")).toBeNull();
  });

  test("trims leading whitespace", () => {
    expect(
      parseWorktreeFromComment("  [village] worktree: /Users/me/project"),
    ).toBe("/Users/me/project");
  });

  test("handles paths with spaces", () => {
    expect(
      parseWorktreeFromComment("[village] worktree: /Users/me/my project"),
    ).toBe("/Users/me/my project");
  });
});

describe("WORKTREE_PREFIX", () => {
  test("is the expected string constant", () => {
    expect(WORKTREE_PREFIX).toBe("[village] worktree: ");
  });
});

// ---------------------------------------------------------------------------
// resolveWorktreePath — thin wrapper around fs.realpath
// ---------------------------------------------------------------------------

describe("resolveWorktreePath", () => {
  test("resolves existing directory to its realpath", async () => {
    // /tmp is typically a symlink on macOS → /private/tmp
    const resolved = await resolveWorktreePath("/tmp");
    expect(resolved).toBeTruthy();
    // Should resolve to a valid path (may or may not change on this OS).
    expect(typeof resolved).toBe("string");
  });

  test("returns input path when directory does not exist", async () => {
    const fakePath = "/nonexistent/path/that/surely/does/not/exist";
    const resolved = await resolveWorktreePath(fakePath);
    expect(resolved).toBe(fakePath);
  });
});

// ---------------------------------------------------------------------------
// Mocked I/O tests — checkWorktreeConflict, getWorktreeFromBead, etc.
//
// IMPORTANT: mock.module() is called inside beforeAll (NOT at module-eval
// time) so Bun does NOT register the stub while loading other test files.
// Sibling files (e.g. br.test.ts) import the real br module when Bun
// evaluates them; the stub only becomes active when these tests run.
// afterAll(() => mock.restore()) cleans up before the next file's tests run.
// ---------------------------------------------------------------------------

// Mock functions declared here (plain stubs — no side effects at module eval).
const mockExecBrJson = mock(() => Promise.resolve([] as any));
const mockExecFileText = mock(() =>
  Promise.resolve({ stdout: "", stderr: "" }),
);

describe("mocked I/O (br stub)", () => {
  // worktree is re-imported inside beforeAll so it picks up the mocked br.
  let worktree!: typeof import("../src/lib/worktree");

  beforeAll(async () => {
    // Register the br stub DURING test execution (not at module load time).
    mock.module("../src/lib/br", () => ({
      execBrJson: mockExecBrJson,
      execFileText: mockExecFileText,
      formatIssueLine: (issue: any) =>
        `${issue.id} | ${issue.title ?? ""} | ${issue.status ?? ""}`,
    }));
    // Re-import worktree now that the stub is active.
    worktree = await import("../src/lib/worktree");
  });

  // Restore the real br module after all mocked tests complete.
  afterAll(() => mock.restore());

  describe("getWorktreeFromBead (mocked)", () => {
    test("extracts worktree path from JSON comment", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { text: "[village] worktree: /Users/me/project" },
      ]);
      const result = await worktree.getWorktreeFromBead("bead-1", {});
      expect(result).toBe("/Users/me/project");
    });

    test("returns null when no worktree comments exist", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { text: "Implementation complete." },
      ]);
      const result = await worktree.getWorktreeFromBead("bead-1", {});
      expect(result).toBeNull();
    });

    test("returns null when comments list is empty", async () => {
      mockExecBrJson.mockResolvedValueOnce([]);
      const result = await worktree.getWorktreeFromBead("bead-1", {});
      expect(result).toBeNull();
    });

    test("falls back to plain text when JSON throws", async () => {
      mockExecBrJson.mockRejectedValueOnce(new Error("json parse fail"));
      mockExecFileText.mockResolvedValueOnce({
        stdout: "some preamble\n[village] worktree: /Users/me/fallback\n",
        stderr: "",
      });
      const result = await worktree.getWorktreeFromBead("bead-1", {});
      expect(result).toBe("/Users/me/fallback");
    });

    test("returns null when both JSON and text fail", async () => {
      mockExecBrJson.mockRejectedValueOnce(new Error("fail"));
      mockExecFileText.mockRejectedValueOnce(new Error("fail"));
      const result = await worktree.getWorktreeFromBead("bead-1", {});
      expect(result).toBeNull();
    });

    test("reads body/content fields as fallback to text", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { body: "[village] worktree: /from/body" },
      ]);
      const result = await worktree.getWorktreeFromBead("bead-1", {});
      expect(result).toBe("/from/body");
    });
  });

  describe("checkWorktreeConflict (mocked)", () => {
    test("returns null when no in-progress beads exist", async () => {
      mockExecBrJson.mockResolvedValueOnce([]);
      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );
      expect(result).toBeNull();
    });

    test("allows same-assignee re-claim (no conflict)", async () => {
      // in-progress bead from same assignee
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-1", assignee: "worker", title: "task", status: "in_progress" },
      ]);
      // getWorktreeFromBead for b-1 (skipped because same assignee)
      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );
      expect(result).toBeNull();
    });

    test("detects conflict with different assignee in same worktree", async () => {
      // br list --status in_progress returns a bead from "overseer"
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-99", assignee: "overseer", title: "review", status: "in_progress" },
      ]);
      // getWorktreeFromBead for b-99 → JSON comments
      mockExecBrJson.mockResolvedValueOnce([
        { text: "[village] worktree: /Users/me/project" },
      ]);

      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );

      expect(result).not.toBeNull();
      expect(result!.beadId).toBe("b-99");
      expect(result!.assignee).toBe("overseer");
      expect(result!.worktreePath).toBe("/Users/me/project");
    });

    test("no conflict when different assignee is in different worktree", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-99", assignee: "overseer", title: "review", status: "in_progress" },
      ]);
      // b-99 is in a different worktree
      mockExecBrJson.mockResolvedValueOnce([
        { text: "[village] worktree: /Users/other/different-project" },
      ]);

      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );
      expect(result).toBeNull();
    });

    test("no conflict when in-progress bead has no worktree comment", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-99", assignee: "overseer", title: "old task", status: "in_progress" },
      ]);
      // No worktree comment on b-99
      mockExecBrJson.mockResolvedValueOnce([]);

      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );
      expect(result).toBeNull();
    });

    test("returns null gracefully when br list fails", async () => {
      mockExecBrJson.mockRejectedValueOnce(new Error("br not found"));
      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );
      expect(result).toBeNull();
    });

    test("skips beads with empty assignee", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-empty", assignee: "", title: "no owner", status: "in_progress" },
      ]);
      const result = await worktree.checkWorktreeConflict(
        "/Users/me/project",
        "worker",
        {},
      );
      expect(result).toBeNull();
    });
  });

  describe("getWorktreeMapping (mocked)", () => {
    test("returns empty array when no in-progress beads", async () => {
      mockExecBrJson.mockResolvedValueOnce([]);
      const entries = await worktree.getWorktreeMapping({});
      expect(entries).toEqual([]);
    });

    test("builds mapping from in-progress beads with worktree comments", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-1", title: "task one", assignee: "worker", status: "in_progress" },
        { id: "b-2", title: "review two", assignee: "overseer", status: "in_progress" },
      ]);
      // Comments for b-1
      mockExecBrJson.mockResolvedValueOnce([
        { text: "[village] worktree: /Users/me/project-a" },
      ]);
      // Comments for b-2
      mockExecBrJson.mockResolvedValueOnce([
        { text: "[village] worktree: /Users/me/project-b" },
      ]);

      const entries = await worktree.getWorktreeMapping({});
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        beadId: "b-1",
        beadTitle: "task one",
        assignee: "worker",
        worktreePath: "/Users/me/project-a",
      });
      expect(entries[1]).toEqual({
        beadId: "b-2",
        beadTitle: "review two",
        assignee: "overseer",
        worktreePath: "/Users/me/project-b",
      });
    });

    test("skips beads without worktree comments", async () => {
      mockExecBrJson.mockResolvedValueOnce([
        { id: "b-1", title: "task", assignee: "worker", status: "in_progress" },
        { id: "b-2", title: "old task", assignee: "overseer", status: "in_progress" },
      ]);
      // b-1 has a worktree comment
      mockExecBrJson.mockResolvedValueOnce([
        { text: "[village] worktree: /Users/me/project" },
      ]);
      // b-2 has no worktree comment
      mockExecBrJson.mockResolvedValueOnce([]);

      const entries = await worktree.getWorktreeMapping({});
      expect(entries).toHaveLength(1);
      expect(entries[0].beadId).toBe("b-1");
    });

    test("returns empty array when br list fails", async () => {
      mockExecBrJson.mockRejectedValueOnce(new Error("br not found"));
      const entries = await worktree.getWorktreeMapping({});
      expect(entries).toEqual([]);
    });
  });
});
