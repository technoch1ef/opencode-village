/**
 * `br` binary preflight check.
 *
 * Runs `br --version` once at plugin init (fire-and-forget).
 * Caches the result for the session lifetime.
 *
 * Tools wrapped with `withBrPreflight` return a clear error message
 * instead of a cryptic failure when `br` is not on PATH.
 *
 * @module
 */

import { execFile as _nodeExecFile } from "node:child_process";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Error message returned by village_* tools when br is not found. */
export const BR_NOT_FOUND_ERROR = "br not found on PATH; install beads_rust";

/** Warning written to stderr at plugin init when br is missing. */
export const BR_WARN_MESSAGE = [
  "[opencode-village] `br` binary not found on PATH. Village tools will fail until you install beads_rust:",
  "  https://github.com/Dicklesworthstone/beads_rust",
].join("\n");

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type ExecFileFn = (
  cmd: string,
  args: string[],
  opts: { timeout?: number },
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

/** Injected execFile function — replaced in unit tests. */
let _execFileFn: ExecFileFn = _nodeExecFile as ExecFileFn;

/**
 * Module-level cache.
 * - `undefined` — check not yet run (or reset)
 * - `null`      — br was found (check passed)
 * - `string`    — br was not found; value is the error message
 */
let _preflightResult: null | string | undefined = undefined;

/** Promise for the in-flight or completed preflight check. */
let _preflightPromise: Promise<void> | undefined = undefined;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function runCheck(): Promise<void> {
  return new Promise<void>((resolve) => {
    _execFileFn("br", ["--version"], { timeout: 5000 }, (err) => {
      if (err) {
        _preflightResult = BR_NOT_FOUND_ERROR;
        process.stderr.write(BR_WARN_MESSAGE + "\n");
      } else {
        _preflightResult = null;
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire the `br --version` check once.
 *
 * Returns a Promise (useful for tests); production call sites should NOT
 * await it (fire-and-forget) so plugin registration is not delayed.
 */
export function startBrPreflight(): Promise<void> {
  if (_preflightPromise !== undefined) return _preflightPromise;
  _preflightPromise = runCheck();
  return _preflightPromise;
}

/**
 * Get the cached preflight result.
 *
 * - `undefined` — check has not completed yet
 * - `null`      — br is available
 * - `string`    — br was not found; the string is the error message to surface
 */
export function getBrPreflightError(): string | null | undefined {
  return _preflightResult;
}

/**
 * Wrap a tool's execute function to return a clear error when br is missing.
 *
 * Only intercepts when the cached preflight result is a non-null string
 * (i.e., br was definitively found to be absent). If the check is still
 * pending (`undefined`) or br is available (`null`), falls through to the
 * original execute.
 */
export function withBrPreflight<
  T extends {
    description: string;
    args: unknown;
    execute(args: unknown, context: unknown): Promise<unknown>;
  },
>(toolDef: T): T {
  const originalExecute = toolDef.execute.bind(toolDef);
  return {
    ...toolDef,
    async execute(args: unknown, context: unknown): Promise<unknown> {
      const preflightErr = getBrPreflightError();
      if (preflightErr) return preflightErr;
      return originalExecute(args, context);
    },
  } as T;
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Override the execFile implementation — for unit tests only. */
export function _setExecFileFn(fn: ExecFileFn): void {
  _execFileFn = fn;
}

/** Reset all module-level state — for unit tests only. */
export function _resetPreflight(): void {
  _preflightResult = undefined;
  _preflightPromise = undefined;
  _execFileFn = _nodeExecFile as ExecFileFn;
}
