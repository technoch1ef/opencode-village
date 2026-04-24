import { afterEach, describe, expect, test } from "bun:test";

import {
  BR_NOT_FOUND_ERROR,
  _resetPreflight,
  _setExecFileFn,
  getBrPreflightError,
  startBrPreflight,
  withBrPreflight,
} from "../src/lib/preflight";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock execFile that simulates a missing `br` binary (ENOENT). */
function makeMissingBrExecFile() {
  return (
    _cmd: string,
    _args: string[],
    _opts: object,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const err = new Error("spawn br ENOENT");
    (err as any).code = "ENOENT";
    cb(err, "", "command not found: br");
  };
}

/** Create a mock execFile that simulates a successful `br --version` call. */
function makeFoundBrExecFile() {
  return (
    _cmd: string,
    _args: string[],
    _opts: object,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(null, "br 0.4.2", "");
  };
}

// ---------------------------------------------------------------------------
// startBrPreflight / getBrPreflightError
// ---------------------------------------------------------------------------

describe("startBrPreflight", () => {
  afterEach(() => {
    _resetPreflight();
  });

  test("caches the error result after a failed check", async () => {
    _setExecFileFn(makeMissingBrExecFile());

    expect(getBrPreflightError()).toBeUndefined();
    await startBrPreflight();
    expect(getBrPreflightError()).toBe(BR_NOT_FOUND_ERROR);
  });

  test("sets result to null when br is found", async () => {
    _setExecFileFn(makeFoundBrExecFile());

    await startBrPreflight();
    expect(getBrPreflightError()).toBeNull();
  });

  test("subsequent calls return the same cached promise (no-op)", async () => {
    let callCount = 0;
    _setExecFileFn((_cmd, _args, _opts, cb) => {
      callCount++;
      cb(null, "br 0.4.2", "");
    });

    const p1 = startBrPreflight();
    const p2 = startBrPreflight(); // should return the same promise
    await Promise.all([p1, p2]);

    // execFile should only be invoked once
    expect(callCount).toBe(1);
  });

  test("writes warning to stderr exactly once when br is missing", async () => {
    const warnings: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);

    (process.stderr as any).write = (chunk: string) => {
      if (typeof chunk === "string" && chunk.includes("[opencode-village]")) {
        warnings.push(chunk);
      }
      return true;
    };

    try {
      _setExecFileFn(makeMissingBrExecFile());

      // First call triggers the actual check.
      await startBrPreflight();
      // Second call is a no-op (returns the cached promise).
      await startBrPreflight();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("[opencode-village]");
      expect(warnings[0]).toContain("beads_rust");
      expect(warnings[0]).toContain(
        "https://github.com/Dicklesworthstone/beads_rust",
      );
    } finally {
      (process.stderr as any).write = originalWrite;
    }
  });
});

// ---------------------------------------------------------------------------
// withBrPreflight wrapper
// ---------------------------------------------------------------------------

describe("withBrPreflight", () => {
  afterEach(() => {
    _resetPreflight();
  });

  test("representative tool returns BR_NOT_FOUND_ERROR when br is missing", async () => {
    _setExecFileFn(makeMissingBrExecFile());
    await startBrPreflight();

    let innerExecuted = false;
    const fakeTool = {
      description: "test tool",
      args: {},
      async execute(_args: unknown, _context: unknown): Promise<string> {
        innerExecuted = true;
        return "should not be reached";
      },
    };

    const wrapped = withBrPreflight(fakeTool);
    const result = await wrapped.execute({}, {} as any);

    expect(result).toBe(BR_NOT_FOUND_ERROR);
    expect(innerExecuted).toBe(false);
  });

  test("passes through to original execute when br is available", async () => {
    _setExecFileFn(makeFoundBrExecFile());
    await startBrPreflight();

    const fakeTool = {
      description: "test tool",
      args: {},
      async execute(_args: unknown, _context: unknown): Promise<string> {
        return "real result";
      },
    };

    const wrapped = withBrPreflight(fakeTool);
    const result = await wrapped.execute({}, {} as any);

    expect(result).toBe("real result");
  });

  test("passes through when preflight has not completed yet (undefined)", async () => {
    // Do NOT call startBrPreflight — result stays undefined.
    expect(getBrPreflightError()).toBeUndefined();

    const fakeTool = {
      description: "test tool",
      args: {},
      async execute(_args: unknown, _context: unknown): Promise<string> {
        return "real result";
      },
    };

    const wrapped = withBrPreflight(fakeTool);
    const result = await wrapped.execute({}, {} as any);

    expect(result).toBe("real result");
  });

  test("wrapping preserves description and args", () => {
    const fakeTool = {
      description: "my description",
      args: { foo: "bar" },
      async execute(): Promise<string> {
        return "ok";
      },
    };

    const wrapped = withBrPreflight(fakeTool);

    expect(wrapped.description).toBe("my description");
    expect(wrapped.args).toEqual({ foo: "bar" });
  });
});
