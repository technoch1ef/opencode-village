import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseBranchFromBody } from "../src/tools/claim";
import { detectBaseBranch, ensureBranch } from "../src/tools/ensure-branch";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Run a git command in a directory. */
function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf-8" }).trim();
}

/** Create a bare "remote" repo and a clone with an initial commit. */
function setupRepoWithRemote(): {
  remote: string;
  local: string;
  cleanup: () => void;
} {
  const base = mkdtempSync(join(tmpdir(), "ensure-branch-test-"));
  const remote = join(base, "remote.git");
  const local = join(base, "local");

  // Create bare remote.
  execSync(`git init --bare "${remote}"`, { encoding: "utf-8" });

  // Clone, create initial commit on main.
  execSync(`git clone "${remote}" "${local}"`, { encoding: "utf-8" });
  git('config user.email "test@test.com"', local);
  git('config user.name "Test"', local);
  writeFileSync(join(local, "README.md"), "# test\n");
  git("add -A", local);
  git('commit -m "initial"', local);
  git("push origin main", local);

  return {
    remote,
    local,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** Create a standalone repo (no remote). */
function setupLocalOnlyRepo(): { local: string; cleanup: () => void } {
  const local = mkdtempSync(join(tmpdir(), "ensure-branch-local-"));
  git("init -b main", local);
  git('config user.email "test@test.com"', local);
  git('config user.name "Test"', local);
  writeFileSync(join(local, "README.md"), "# test\n");
  git("add -A", local);
  git('commit -m "initial"', local);

  return {
    local,
    cleanup: () => rmSync(local, { recursive: true, force: true }),
  };
}

// ─── parseBranchFromBody ────────────────────────────────────────────────────

describe("parseBranchFromBody", () => {
  test("parses fenced branch name", () => {
    const body = "## Context\nSome text\n\n## Branch\n\n`epic/village-v2`\n\n## Notes\n";
    expect(parseBranchFromBody(body)).toBe("epic/village-v2");
  });

  test("parses plain branch name", () => {
    const body = "## Branch\nepic/foo-bar\n";
    expect(parseBranchFromBody(body)).toBe("epic/foo-bar");
  });

  test("returns undefined for missing section", () => {
    expect(parseBranchFromBody("## Context\nNo branch here")).toBeUndefined();
  });

  test("returns undefined for undefined/null/empty", () => {
    expect(parseBranchFromBody(undefined)).toBeUndefined();
    expect(parseBranchFromBody(null)).toBeUndefined();
    expect(parseBranchFromBody("")).toBeUndefined();
  });

  test("handles ## Branch with extra whitespace", () => {
    const body = "##  Branch  \n\n  `epic/test`  \n";
    expect(parseBranchFromBody(body)).toBe("epic/test");
  });

  test("parses non-epic branch names too", () => {
    const body = "## Branch\n`feature/my-thing`\n";
    expect(parseBranchFromBody(body)).toBe("feature/my-thing");
  });
});

// ─── detectBaseBranch ───────────────────────────────────────────────────────

describe("detectBaseBranch", () => {
  let repo: ReturnType<typeof setupRepoWithRemote>;

  beforeAll(() => {
    repo = setupRepoWithRemote();
  });

  afterAll(() => {
    repo.cleanup();
  });

  test("detects main from remote", async () => {
    const base = await detectBaseBranch(repo.local);
    expect(base).toBe("main");
  });

  test("detects main from local-only repo", async () => {
    const localRepo = setupLocalOnlyRepo();
    try {
      const base = await detectBaseBranch(localRepo.local);
      expect(base).toBe("main");
    } finally {
      localRepo.cleanup();
    }
  });
});

// ─── ensureBranch ───────────────────────────────────────────────────────────

describe("ensureBranch", () => {
  describe("with remote", () => {
    let repo: ReturnType<typeof setupRepoWithRemote>;

    beforeEach(() => {
      repo = setupRepoWithRemote();
    });

    afterAll(() => {
      // afterAll catches the last one; individual cleanup in each test too.
    });

    test("creates a new epic branch from origin/main (first claim)", async () => {
      try {
        const result = await ensureBranch({
          branch: "epic/test-feature",
          directory: repo.local,
        });

        expect(result.action).toBe("created");
        expect(result.branch).toBe("epic/test-feature");
        expect(result.base).toBe("main");

        // Verify we're on the right branch.
        const current = git("rev-parse --abbrev-ref HEAD", repo.local);
        expect(current).toBe("epic/test-feature");
      } finally {
        repo.cleanup();
      }
    });

    test("fast-forwards existing branch (subsequent claim)", async () => {
      try {
        // First: create the epic branch.
        await ensureBranch({
          branch: "epic/ff-test",
          directory: repo.local,
        });

        // Create a commit on main via the remote.
        git("checkout main", repo.local);
        writeFileSync(join(repo.local, "new-file.txt"), "hello\n");
        git("add -A", repo.local);
        git('commit -m "advance main"', repo.local);
        git("push origin main", repo.local);

        // Go back to epic branch.
        git("checkout epic/ff-test", repo.local);

        // Second claim: should fast-forward.
        const result = await ensureBranch({
          branch: "epic/ff-test",
          directory: repo.local,
        });

        expect(result.action).toBe("updated");
        expect(result.warnings).toEqual([]);
      } finally {
        repo.cleanup();
      }
    });

    test("skips ff-merge on dirty working tree with warning", async () => {
      try {
        await ensureBranch({
          branch: "epic/dirty-test",
          directory: repo.local,
        });

        // Dirty the working tree.
        writeFileSync(join(repo.local, "uncommitted.txt"), "dirty\n");

        const result = await ensureBranch({
          branch: "epic/dirty-test",
          directory: repo.local,
        });

        expect(result.action).toBe("skipped");
        expect(result.warnings).toContain(
          "dirty working tree: skipping ff-merge",
        );
      } finally {
        repo.cleanup();
      }
    });

    test("warns on non-fast-forward divergence without error", async () => {
      try {
        // Create epic branch.
        await ensureBranch({
          branch: "epic/diverge-test",
          directory: repo.local,
        });

        // Create a commit ON the epic branch (diverging).
        writeFileSync(join(repo.local, "epic-only.txt"), "diverge\n");
        git("add -A", repo.local);
        git('commit -m "epic commit"', repo.local);

        // Also advance main on remote.
        git("checkout main", repo.local);
        writeFileSync(join(repo.local, "main-only.txt"), "main advance\n");
        git("add -A", repo.local);
        git('commit -m "main commit"', repo.local);
        git("push origin main", repo.local);
        git("checkout epic/diverge-test", repo.local);

        const result = await ensureBranch({
          branch: "epic/diverge-test",
          directory: repo.local,
        });

        // Should not error, just warn.
        expect(result.action).toBe("checked_out");
        expect(
          result.warnings.some((w) => w.includes("non-fast-forward")),
        ).toBe(true);
      } finally {
        repo.cleanup();
      }
    });

    test("tracks remote branch if it exists on origin but not locally", async () => {
      try {
        // Create and push an epic branch to remote.
        git("checkout -b epic/remote-only", repo.local);
        writeFileSync(join(repo.local, "remote.txt"), "remote\n");
        git("add -A", repo.local);
        git('commit -m "remote branch commit"', repo.local);
        git("push origin epic/remote-only", repo.local);

        // Delete local branch and go back to main.
        git("checkout main", repo.local);
        git("branch -D epic/remote-only", repo.local);

        // Now ensure — should track from origin.
        const result = await ensureBranch({
          branch: "epic/remote-only",
          directory: repo.local,
        });

        expect(result.action).toBe("created");
        const current = git("rev-parse --abbrev-ref HEAD", repo.local);
        expect(current).toBe("epic/remote-only");
      } finally {
        repo.cleanup();
      }
    });
  });

  describe("without remote", () => {
    test("creates branch from local base when no remote exists", async () => {
      const localRepo = setupLocalOnlyRepo();
      try {
        const result = await ensureBranch({
          branch: "epic/local-only",
          directory: localRepo.local,
        });

        expect(result.action).toBe("created");
        expect(result.branch).toBe("epic/local-only");
        // Should have a warning about fetch failing or just succeed silently.
        // The branch should be based on local main.
        const current = git("rev-parse --abbrev-ref HEAD", localRepo.local);
        expect(current).toBe("epic/local-only");
      } finally {
        localRepo.cleanup();
      }
    });
  });
});

// ─── non-epic branch guard ─────────────────────────────────────────────────

describe("village_claim branch integration", () => {
  test("parseBranchFromBody returns non-epic branches that are NOT auto-created", () => {
    // The claim integration uses `if (!/^epic\//.test(branch)) return undefined;`
    // so non-epic branches are parsed but NOT passed to ensureBranch.
    const branch = parseBranchFromBody("## Branch\n`feature/not-epic`\n");
    expect(branch).toBe("feature/not-epic");
    // The integration code in claim.ts checks /^epic\// before calling ensureBranch.
    expect(/^epic\//.test(branch!)).toBe(false);
  });

  test("epic branches ARE eligible for auto-creation", () => {
    const branch = parseBranchFromBody("## Branch\n`epic/my-feature`\n");
    expect(branch).toBe("epic/my-feature");
    expect(/^epic\//.test(branch!)).toBe(true);
  });
});
