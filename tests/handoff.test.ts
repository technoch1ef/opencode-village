import { describe, expect, test } from "bun:test";

import {
  isHandoffAllowed,
  formatHandoffComment,
  HANDOFF_MATRIX,
  VILLAGE_ROLES,
} from "../src/tools/handoff";

describe("VILLAGE_ROLES", () => {
  test("contains all five village roles", () => {
    expect(VILLAGE_ROLES.has("mayor")).toBe(true);
    expect(VILLAGE_ROLES.has("worker")).toBe(true);
    expect(VILLAGE_ROLES.has("inspector")).toBe(true);
    expect(VILLAGE_ROLES.has("guard")).toBe(true);
    expect(VILLAGE_ROLES.has("envoy")).toBe(true);
  });

  test("does not contain unknown roles", () => {
    expect(VILLAGE_ROLES.has("admin")).toBe(false);
    expect(VILLAGE_ROLES.has("")).toBe(false);
  });

  test("has exactly 5 entries", () => {
    expect(VILLAGE_ROLES.size).toBe(5);
  });
});

describe("HANDOFF_MATRIX", () => {
  test("worker can only hand off to inspector", () => {
    expect(HANDOFF_MATRIX.worker.size).toBe(1);
    expect(HANDOFF_MATRIX.worker.has("inspector")).toBe(true);
  });

  test("inspector can hand off to guard, worker, mayor", () => {
    expect(HANDOFF_MATRIX.inspector.size).toBe(3);
    expect(HANDOFF_MATRIX.inspector.has("guard")).toBe(true);
    expect(HANDOFF_MATRIX.inspector.has("worker")).toBe(true);
    expect(HANDOFF_MATRIX.inspector.has("mayor")).toBe(true);
  });

  test("guard can hand off to worker, inspector, and envoy", () => {
    expect(HANDOFF_MATRIX.guard.size).toBe(3);
    expect(HANDOFF_MATRIX.guard.has("worker")).toBe(true);
    expect(HANDOFF_MATRIX.guard.has("inspector")).toBe(true);
    expect(HANDOFF_MATRIX.guard.has("envoy")).toBe(true);
  });

  test("mayor can only hand off to worker", () => {
    expect(HANDOFF_MATRIX.mayor.size).toBe(1);
    expect(HANDOFF_MATRIX.mayor.has("worker")).toBe(true);
  });

  test("envoy has no outgoing handoffs", () => {
    expect(HANDOFF_MATRIX.envoy.size).toBe(0);
  });
});

describe("isHandoffAllowed", () => {
  // Valid handoffs
  test("worker -> inspector is allowed", () => {
    expect(isHandoffAllowed("worker", "inspector")).toBe(true);
  });

  test("inspector -> guard is allowed", () => {
    expect(isHandoffAllowed("inspector", "guard")).toBe(true);
  });

  test("inspector -> worker is allowed (changes requested)", () => {
    expect(isHandoffAllowed("inspector", "worker")).toBe(true);
  });

  test("inspector -> mayor is allowed (out of scope)", () => {
    expect(isHandoffAllowed("inspector", "mayor")).toBe(true);
  });

  test("guard -> worker is allowed (checks failed)", () => {
    expect(isHandoffAllowed("guard", "worker")).toBe(true);
  });

  test("guard -> envoy is allowed (release/PR)", () => {
    expect(isHandoffAllowed("guard", "envoy")).toBe(true);
  });

  test("mayor -> worker is allowed (rescope)", () => {
    expect(isHandoffAllowed("mayor", "worker")).toBe(true);
  });

  // Invalid handoffs (actor -> target not in matrix)
  test("worker -> guard is not allowed", () => {
    expect(isHandoffAllowed("worker", "guard")).toBe(false);
  });

  test("worker -> mayor is not allowed", () => {
    expect(isHandoffAllowed("worker", "mayor")).toBe(false);
  });

  test("worker -> envoy is not allowed", () => {
    expect(isHandoffAllowed("worker", "envoy")).toBe(false);
  });

  test("guard -> inspector is allowed (defensive return)", () => {
    expect(isHandoffAllowed("guard", "inspector")).toBe(true);
  });

  test("envoy -> any is not allowed", () => {
    expect(isHandoffAllowed("envoy", "worker")).toBe(false);
    expect(isHandoffAllowed("envoy", "guard")).toBe(false);
    expect(isHandoffAllowed("envoy", "mayor")).toBe(false);
    expect(isHandoffAllowed("envoy", "inspector")).toBe(false);
  });

  // Unknown roles
  test("unknown source role returns false", () => {
    expect(isHandoffAllowed("admin", "worker")).toBe(false);
  });

  test("unknown target role returns false", () => {
    expect(isHandoffAllowed("worker", "admin")).toBe(false);
  });

  test("both unknown returns false", () => {
    expect(isHandoffAllowed("foo", "bar")).toBe(false);
  });
});

describe("formatHandoffComment", () => {
  test("formats a standard handoff comment", () => {
    const result = formatHandoffComment(
      "worker",
      "inspector",
      "Implementation complete. Ready for review.",
    );
    expect(result).toBe(
      "[handoff worker\u2192inspector] Implementation complete. Ready for review.",
    );
  });

  test("includes arrow unicode character", () => {
    const result = formatHandoffComment("guard", "envoy", "Checks passed.");
    expect(result).toContain("\u2192");
    expect(result).toBe("[handoff guard\u2192envoy] Checks passed.");
  });

  test("preserves note content verbatim", () => {
    const note = "Changes requested:\n- Fix lint errors\n- Add missing type";
    const result = formatHandoffComment("inspector", "worker", note);
    expect(result).toBe(`[handoff inspector\u2192worker] ${note}`);
  });
});
