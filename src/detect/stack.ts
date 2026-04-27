/**
 * Stack auto-detection — maps repo signals to skill names.
 *
 * Pure function `detectStack(cwd)` walks from `cwd` up to the repo root
 * (`.git`), checks both the root and any `packages/*` subdirectories,
 * and returns a deduplicated list of skill names.
 *
 * `beads-workflow` is always included as the first element.
 *
 * @module
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Signal-to-skill mapping.
 *
 * Each entry describes a filesystem signal and the skill it implies.
 * Only skills that actually exist in the `skills/` directory are shipped;
 * deferred entries are commented for future reference.
 */
type SignalChecker = (dir: string) => Promise<string | null>;

/** Check if a path exists and is a file. */
async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/** Check if a path exists (file or directory). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Check if a path exists and is a directory. */
async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk upwards from `start` to find the nearest `.git` marker (file or directory).
 * Returns the directory containing `.git`, or `start` if none found.
 *
 * Note: `.git` can be a directory (normal repos) or a file (worktrees/submodules).
 */
export async function findRepoRoot(start: string): Promise<string> {
  let current = resolve(start);
  const root = dirname(current);

  while (current !== root) {
    if (await pathExists(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Check the filesystem root too
  if (await pathExists(join(current, ".git"))) {
    return current;
  }

  return resolve(start);
}

/**
 * Collect directories to scan: the repo root plus any `packages/*` subdirectories
 * (monorepo support).
 */
async function collectScanDirs(repoRoot: string): Promise<string[]> {
  const dirs = [repoRoot];

  const packagesDir = join(repoRoot, "packages");
  if (await dirExists(packagesDir)) {
    try {
      const entries = await readdir(packagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(join(packagesDir, entry.name));
        }
      }
    } catch {
      // Ignore permission errors etc.
    }
  }

  return dirs;
}

// --- Signal checkers ---

/** `package.json` → `stack-typescript` */
const checkTypescript: SignalChecker = async (dir) => {
  if (await fileExists(join(dir, "package.json"))) {
    return "stack-typescript";
  }
  return null;
};

/** `Gemfile` containing `rails` → `stack-ruby-on-rails` */
const checkRails: SignalChecker = async (dir) => {
  const gemfilePath = join(dir, "Gemfile");
  if (!(await fileExists(gemfilePath))) return null;

  try {
    const content = await readFile(gemfilePath, "utf-8");
    if (/rails/i.test(content)) {
      return "stack-ruby-on-rails";
    }
  } catch {
    // Ignore
  }
  return null;
};

// --- Deferred stacks (detection signals defined, skills not yet shipped) ---

// `Cargo.toml` (no Anchor) → `stack-rust` (deferred)
// `go.mod` → `stack-go` (deferred)
// `pyproject.toml` / `requirements.txt` → `stack-python` (deferred)

/**
 * All active signal checkers.
 * Order matters for determinism but not for correctness (results are deduplicated).
 */
const SIGNAL_CHECKERS: SignalChecker[] = [
  checkTypescript,
  checkRails,
];

/**
 * Detect the project's technology stack from the given directory.
 *
 * Walks up to the repo root, checks both root and `packages/*` subdirectories,
 * and returns a deduplicated list of skill names.
 *
 * `beads-workflow` is always the first element. When no stack is detected,
 * the result is `["beads-workflow"]`.
 *
 * @param cwd - Starting directory to detect from
 * @returns Array of skill name strings, always starting with `"beads-workflow"`
 */
export async function detectStack(cwd: string): Promise<string[]> {
  const repoRoot = await findRepoRoot(cwd);
  const scanDirs = await collectScanDirs(repoRoot);

  const skills = new Set<string>();

  for (const dir of scanDirs) {
    for (const checker of SIGNAL_CHECKERS) {
      const skill = await checker(dir);
      if (skill) {
        skills.add(skill);
      }
    }
  }

  // Always ensure beads-workflow is first, then sort remaining for determinism.
  const sorted = Array.from(skills).sort();
  return ["beads-workflow", ...sorted];
}

/**
 * Merge detected skills into an existing list, deduplicating.
 *
 * `beads-workflow` is always first. The rest are sorted alphabetically
 * for deterministic output.
 */
export function mergeSkills(existing: string[], detected: string[]): string[] {
  const all = new Set<string>();
  for (const s of existing) {
    if (s && s !== "beads-workflow") all.add(s);
  }
  for (const s of detected) {
    if (s && s !== "beads-workflow") all.add(s);
  }

  const sorted = Array.from(all).sort();
  return ["beads-workflow", ...sorted];
}
