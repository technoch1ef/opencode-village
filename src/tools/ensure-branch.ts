/**
 * `village_ensure_branch` tool — create or switch to an epic branch and
 * optionally fast-forward it from the default base branch.
 *
 * This is the **only** branch-creation power a worker gets (limited to `epic/*`).
 *
 * Behaviour:
 * 1. Detect the default base branch (`main` or `master`).
 * 2. `git fetch origin <base>` (best-effort; no-op if no remote).
 * 3. If the branch does NOT exist locally:
 *    - If it exists on `origin`: `git checkout -B <branch> origin/<branch>`
 *    - Otherwise: `git checkout -b <branch> origin/<base>` (or local `<base>` if no remote)
 * 4. If the branch DOES exist locally:
 *    - `git checkout <branch>`
 *    - If clean working tree: `git merge origin/<base> --ff-only` (skip if non-fast-forward)
 *    - If dirty working tree: skip merge, return warning
 * 5. Never force-pushes, force-resets, or rebases.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execFileText } from "../lib/br";

/** Structured result returned by the ensure-branch logic. */
export interface EnsureBranchResult {
  branch: string;
  base: string;
  action: "created" | "checked_out" | "updated" | "skipped";
  warnings: string[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Run a git command, returning stdout/stderr. Does NOT throw on non-zero exit
 * when `allowFailure` is set.
 */
async function git(
  args: string[],
  cwd: string,
  opts?: { allowFailure?: boolean },
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const result = await execFileText("git", args, { cwd });
    return { ...result, ok: true };
  } catch (err: any) {
    if (opts?.allowFailure) {
      return {
        stdout: String(err?.stdout ?? ""),
        stderr: String(err?.stderr ?? ""),
        ok: false,
      };
    }
    throw err;
  }
}

/**
 * Detect the default base branch.
 *
 * Strategy:
 * 1. `git symbolic-ref refs/remotes/origin/HEAD` → strip `refs/remotes/origin/`
 * 2. Fall back: check if `main` exists (local or remote), then `master`.
 */
export async function detectBaseBranch(cwd: string): Promise<string> {
  // Try symbolic-ref first (most accurate).
  const symref = await git(
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    cwd,
    { allowFailure: true },
  );
  if (symref.ok) {
    const ref = symref.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    if (ref) return ref;
  }

  // Fall back: check for main / master (remote first, then local).
  for (const candidate of ["main", "master"]) {
    const remote = await git(
      ["rev-parse", "--verify", `refs/remotes/origin/${candidate}`],
      cwd,
      { allowFailure: true },
    );
    if (remote.ok) return candidate;

    const local = await git(
      ["rev-parse", "--verify", `refs/heads/${candidate}`],
      cwd,
      { allowFailure: true },
    );
    if (local.ok) return candidate;
  }

  // Last resort — default to "main".
  return "main";
}

/**
 * Check whether the working tree is clean (no unstaged/staged changes).
 */
async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const status = await git(["status", "--porcelain"], cwd, {
    allowFailure: true,
  });
  return status.ok && status.stdout.trim() === "";
}

/**
 * Check whether a local branch exists.
 */
async function localBranchExists(
  branch: string,
  cwd: string,
): Promise<boolean> {
  const result = await git(
    ["rev-parse", "--verify", `refs/heads/${branch}`],
    cwd,
    { allowFailure: true },
  );
  return result.ok;
}

/**
 * Check whether a remote branch exists on origin.
 */
async function remoteBranchExists(
  branch: string,
  cwd: string,
): Promise<boolean> {
  const result = await git(
    ["rev-parse", "--verify", `refs/remotes/origin/${branch}`],
    cwd,
    { allowFailure: true },
  );
  return result.ok;
}

/**
 * Check whether a remote named "origin" exists.
 */
async function hasOriginRemote(cwd: string): Promise<boolean> {
  const result = await git(["remote", "get-url", "origin"], cwd, {
    allowFailure: true,
  });
  return result.ok;
}

// ─── core logic ─────────────────────────────────────────────────────────────

/**
 * Ensure a branch exists, is checked out, and is up-to-date with the base.
 *
 * Exported so it can be called directly from `village_claim` integration
 * without going through the tool dispatch layer.
 */
export async function ensureBranch(opts: {
  branch: string;
  base?: "main" | "master" | "auto";
  directory: string;
}): Promise<EnsureBranchResult> {
  const { branch, directory } = opts;
  const warnings: string[] = [];

  // 1. Detect base branch.
  const base =
    opts.base && opts.base !== "auto"
      ? opts.base
      : await detectBaseBranch(directory);

  // 2. Best-effort fetch.
  const hasRemote = await hasOriginRemote(directory);
  if (hasRemote) {
    const fetch = await git(["fetch", "origin", base], directory, {
      allowFailure: true,
    });
    if (!fetch.ok) {
      warnings.push(`fetch origin ${base} failed (continuing offline)`);
    }
    // Also fetch the branch itself so we know if it exists on remote.
    await git(["fetch", "origin", branch], directory, {
      allowFailure: true,
    });
  }

  // 3. Branch creation or checkout.
  const existsLocally = await localBranchExists(branch, directory);

  if (!existsLocally) {
    // Branch does not exist locally.
    const existsRemotely = hasRemote
      ? await remoteBranchExists(branch, directory)
      : false;

    if (existsRemotely) {
      // Track the remote branch.
      await git(["checkout", "-B", branch, `origin/${branch}`], directory);
    } else {
      // Create new branch from base.
      const remoteBaseExists = hasRemote
        ? await remoteBranchExists(base, directory)
        : false;

      const startPoint = remoteBaseExists ? `origin/${base}` : base;
      await git(["checkout", "-b", branch, startPoint], directory);
    }

    return { branch, base, action: "created", warnings };
  }

  // 4. Branch exists locally — check it out.
  const currentBranch = (
    await git(["rev-parse", "--abbrev-ref", "HEAD"], directory)
  ).stdout.trim();

  if (currentBranch !== branch) {
    await git(["checkout", branch], directory);
  }

  // 5. Fast-forward merge if clean.
  const clean = await isWorkingTreeClean(directory);
  if (!clean) {
    warnings.push("dirty working tree: skipping ff-merge");
    return { branch, base, action: "skipped", warnings };
  }

  // Only attempt ff-merge if remote base exists.
  const remoteBaseExists = hasRemote
    ? await remoteBranchExists(base, directory)
    : false;

  if (!remoteBaseExists) {
    return { branch, base, action: "checked_out", warnings };
  }

  const merge = await git(
    ["merge", `origin/${base}`, "--ff-only"],
    directory,
    { allowFailure: true },
  );

  if (!merge.ok) {
    warnings.push(
      `non-fast-forward: branch has diverged from origin/${base} — leaving as-is`,
    );
    return { branch, base, action: "checked_out", warnings };
  }

  return { branch, base, action: "updated", warnings };
}

// ─── tool definition ────────────────────────────────────────────────────────

/**
 * Create the `village_ensure_branch` tool definition.
 *
 * Unlike most village tools this one does NOT require session helpers (it only
 * interacts with git, not beads).
 */
export function createEnsureBranchTool() {
  return tool({
    description:
      "Ensure an epic branch exists, is checked out, and is up-to-date with main/master via fast-forward. " +
      "Creates the branch from the default base if it doesn't exist. Never force-pushes, rebases, or creates merge commits.",
    args: {
      branch: tool.schema.string(),
      base: tool.schema
        .enum(["main", "master", "auto"] as const)
        .optional(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const result = await ensureBranch({
        branch: args.branch,
        base: args.base ?? "auto",
        directory,
      });

      const parts = [
        `branch: ${result.branch}`,
        `base: ${result.base}`,
        `action: ${result.action}`,
      ];
      if (result.warnings.length) {
        parts.push(`warnings: ${result.warnings.join("; ")}`);
      }
      return parts.join(" | ");
    },
  });
}
