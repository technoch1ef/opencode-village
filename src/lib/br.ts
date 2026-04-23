/**
 * `br` CLI helpers — all shell-out logic and BD_ACTOR injection.
 *
 * Single source of truth for interacting with the `br` (beads_rust) binary.
 */

import { execFile } from "node:child_process";
import type { BrIssue } from "./shared";

/** Agent name to BD_ACTOR mapping. */
export const AGENT_TO_ACTOR: Record<string, string> = {
  mayor: "mayor",
  worker: "worker",
  overseer: "overseer",
  inspector: "inspector",
  guard: "guard",
  envoy: "envoy",
};

/**
 * Execute a command and capture stdout/stderr as strings.
 */
export async function execFileText(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 5 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            `Command failed: ${[file, ...args].join(" ")}\n${String(stderr || stdout).slice(0, 2000)}`,
          );
          (e as any).cause = err;
          (e as any).stdout = stdout;
          (e as any).stderr = stderr;
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Run `br <args> --json` style commands and parse the JSON output.
 */
export async function execBrJson<T>(
  args: string[],
  options: {
    cwd?: string;
    actor?: string;
  },
): Promise<T> {
  const env = {
    ...process.env,
    ...(options.actor ? { BD_ACTOR: options.actor } : {}),
  } as Record<string, string | undefined>;

  const { stdout } = await execFileText("br", args, { cwd: options.cwd, env });

  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(
      `Failed to parse JSON from: br ${args.join(" ")}\n` +
        `Output: ${stdout.slice(0, 2000)}`,
    );
  }
}

/**
 * Safely extract the first `BrIssue` from a br command's output
 * (which may be a single object or an array).
 */
export function firstBrIssue(value: unknown): BrIssue | undefined {
  if (Array.isArray(value)) return value.length ? firstBrIssue(value[0]) : undefined;
  if (!value || typeof value !== "object") return undefined;
  const v = value as any;
  if (typeof v.id !== "string") return undefined;
  return v as BrIssue;
}

/** Format a bead as `id | title | status`. */
export function formatIssueLine(issue: BrIssue): string {
  const id = issue.id;
  const title = (issue.title ?? "").replace(/\s+/g, " ").trim();
  const status = (issue.status ?? "").trim();
  return `${id} | ${title || "(no title)"} | ${status || "(no status)"}`;
}

/** Format a bead as `id | title | status | assignee`. */
export function formatOrphansRow(issue: BrIssue): string {
  const id = issue.id;
  const title = (issue.title ?? "").replace(/\s+/g, " ").trim() || "(no title)";
  const status = (issue.status ?? "").trim() || "(no status)";
  const assignee = (issue.assignee ?? "").trim() || "(unassigned)";
  return `${id} | ${title} | ${status} | ${assignee}`;
}
