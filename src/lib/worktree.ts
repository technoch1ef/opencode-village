/**
 * Worktree conflict detection for `village_claim`.
 *
 * Prevents two agents from claiming beads in the same git worktree,
 * which would cause merge conflicts.
 *
 * Comment format: `[village] worktree: <abs-path>`
 *
 * @module
 */

import { realpath } from "node:fs/promises";
import {
  execBrJson as execBrJsonImpl,
  execFileText as execFileTextImpl,
} from "./br";
import type { BrIssue } from "./shared";

/** Machine-parseable prefix for worktree comments. */
export const WORKTREE_PREFIX = "[village] worktree: ";

/**
 * Injectable I/O dependencies for worktree functions.
 *
 * All fields are optional — omit any field to use the real `br` implementation.
 * Pass mocks in tests to avoid `mock.module()` and the Bun module-cache
 * pollution it causes.
 */
export type WorktreeDeps = {
  execBrJson?: <T>(
    args: string[],
    options: { cwd?: string; actor?: string },
  ) => Promise<T>;
  execFileText?: (
    file: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string | undefined> },
  ) => Promise<{ stdout: string; stderr: string }>;
};

/**
 * Format a worktree comment for a bead.
 */
export function formatWorktreeComment(absPath: string): string {
  return `${WORKTREE_PREFIX}${absPath}`;
}

/**
 * Parse the worktree path from a comment string.
 * Returns `null` if the comment is not a worktree comment.
 */
export function parseWorktreeFromComment(comment: string): string | null {
  const trimmed = comment.trim();
  if (trimmed.startsWith(WORKTREE_PREFIX)) {
    const path = trimmed.slice(WORKTREE_PREFIX.length).trim();
    return path || null;
  }
  return null;
}

/**
 * Resolve the real absolute path of a directory (handles symlinks).
 */
export async function resolveWorktreePath(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch {
    return directory;
  }
}

/**
 * A parsed worktree mapping entry (bead → worktree path).
 */
export type WorktreeEntry = {
  beadId: string;
  beadTitle: string;
  assignee: string;
  worktreePath: string;
};

/**
 * A detected worktree conflict.
 */
export type WorktreeConflict = {
  /** The conflicting bead ID. */
  beadId: string;
  /** The conflicting bead's assignee. */
  assignee: string;
  /** The shared worktree path. */
  worktreePath: string;
};

/**
 * Extract worktree comments from a bead by listing its comments via `br comments list`.
 *
 * Returns the first worktree path found, or `null`.
 */
export async function getWorktreeFromBead(
  beadId: string,
  options: { cwd?: string; actor?: string },
  deps: WorktreeDeps = {},
): Promise<string | null> {
  const _execBrJson = deps.execBrJson ?? execBrJsonImpl;
  const _execFileText = deps.execFileText ?? execFileTextImpl;

  try {
    // Try JSON first
    const comments = await _execBrJson<
      Array<{ text?: string; body?: string; content?: string }>
    >(["comments", "list", beadId, "--json"], options);

    if (Array.isArray(comments)) {
      for (const c of comments) {
        const text = c.text ?? c.body ?? c.content ?? "";
        const path = parseWorktreeFromComment(text);
        if (path) return path;
      }
    }
  } catch {
    // JSON parsing failed — try plain text output
    try {
      const env = {
        ...process.env,
        ...(options.actor ? { BD_ACTOR: options.actor } : {}),
      } as Record<string, string | undefined>;

      const { stdout } = await _execFileText(
        "br",
        ["comments", "list", beadId],
        { cwd: options.cwd, env },
      );

      for (const line of stdout.split("\n")) {
        const path = parseWorktreeFromComment(line);
        if (path) return path;
      }
    } catch {
      // No comments available — proceed without worktree info.
    }
  }

  return null;
}

/**
 * Post a worktree comment on a bead.
 */
export async function postWorktreeComment(
  beadId: string,
  absPath: string,
  options: { cwd?: string; actor?: string },
): Promise<void> {
  const comment = formatWorktreeComment(absPath);
  const env = {
    ...process.env,
    ...(options.actor ? { BD_ACTOR: options.actor } : {}),
  } as Record<string, string | undefined>;

  await execFileTextImpl("br", ["comments", "add", beadId, comment], {
    cwd: options.cwd,
    env,
  });
}

/**
 * Check for worktree conflicts among all in-progress beads.
 *
 * Returns a conflict if another assignee holds an in-progress bead
 * in the same worktree. Same-assignee re-claims are allowed.
 */
export async function checkWorktreeConflict(
  worktreePath: string,
  assignee: string,
  options: { cwd?: string; actor?: string },
  deps: WorktreeDeps = {},
): Promise<WorktreeConflict | null> {
  const _execBrJson = deps.execBrJson ?? execBrJsonImpl;

  // Get ALL in-progress beads (not filtered by assignee).
  let allInProgress: BrIssue[];
  try {
    allInProgress = await _execBrJson<BrIssue[]>(
      ["list", "--status", "in_progress", "--json"],
      options,
    );
  } catch {
    // If we can't list, don't block the claim.
    return null;
  }

  if (!Array.isArray(allInProgress)) return null;

  for (const bead of allInProgress) {
    const beadAssignee = (bead.assignee ?? "").trim();
    // Skip beads from the same assignee — same-assignee re-claim is allowed.
    if (beadAssignee === assignee) continue;
    if (!beadAssignee) continue;

    const beadWorktree = await getWorktreeFromBead(bead.id, options, deps);
    if (!beadWorktree) continue;

    if (beadWorktree === worktreePath) {
      return {
        beadId: bead.id,
        assignee: beadAssignee,
        worktreePath,
      };
    }
  }

  return null;
}

/**
 * Build the current worktree → bead mapping from all in-progress beads.
 */
export async function getWorktreeMapping(
  options: {
    cwd?: string;
    actor?: string;
  },
  deps: WorktreeDeps = {},
): Promise<WorktreeEntry[]> {
  const _execBrJson = deps.execBrJson ?? execBrJsonImpl;

  let allInProgress: BrIssue[];
  try {
    allInProgress = await _execBrJson<BrIssue[]>(
      ["list", "--status", "in_progress", "--json"],
      options,
    );
  } catch {
    return [];
  }

  if (!Array.isArray(allInProgress)) return [];

  const entries: WorktreeEntry[] = [];
  for (const bead of allInProgress) {
    const worktreePath = await getWorktreeFromBead(bead.id, options, deps);
    if (worktreePath) {
      entries.push({
        beadId: bead.id,
        beadTitle: (bead.title ?? "").replace(/\s+/g, " ").trim(),
        assignee: (bead.assignee ?? "").trim(),
        worktreePath,
      });
    }
  }

  return entries;
}
