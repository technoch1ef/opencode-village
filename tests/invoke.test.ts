import { describe, expect, test } from "bun:test";

import {
  SPECIALISTS,
  SPECIALIST_MARKER_PREFIX,
  formatSpecialistComment,
  hasSpecialistMarker,
  parseSpecialistFromComment,
} from "../src/tools/invoke";
import type { BrIssue } from "../src/lib/shared";

// ---------------------------------------------------------------------------
// SPECIALISTS set
// ---------------------------------------------------------------------------
describe("SPECIALISTS", () => {
  test("contains envoy", () => {
    expect(SPECIALISTS.has("envoy")).toBe(true);
  });

  test("has exactly 1 entry", () => {
    expect(SPECIALISTS.size).toBe(1);
  });

  test("does not contain default roles", () => {
    expect(SPECIALISTS.has("worker" as any)).toBe(false);
    expect(SPECIALISTS.has("inspector" as any)).toBe(false);
    expect(SPECIALISTS.has("guard" as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SPECIALIST_MARKER_PREFIX
// ---------------------------------------------------------------------------
describe("SPECIALIST_MARKER_PREFIX", () => {
  test("has expected value", () => {
    expect(SPECIALIST_MARKER_PREFIX).toBe("[village] needs ");
  });
});

// ---------------------------------------------------------------------------
// formatSpecialistComment
// ---------------------------------------------------------------------------
describe("formatSpecialistComment", () => {
  test("formats with note", () => {
    expect(formatSpecialistComment("envoy", "Please open a PR")).toBe(
      "[village] needs envoy: Please open a PR",
    );
  });

  test("formats without note", () => {
    expect(formatSpecialistComment("envoy")).toBe("[village] needs envoy");
  });

  test("formats with empty note", () => {
    expect(formatSpecialistComment("envoy", "")).toBe(
      "[village] needs envoy",
    );
  });

  test("preserves note content verbatim", () => {
    const note = "Multi\nline\nnote";
    expect(formatSpecialistComment("envoy", note)).toBe(
      `[village] needs envoy: ${note}`,
    );
  });
});

// ---------------------------------------------------------------------------
// hasSpecialistMarker
// ---------------------------------------------------------------------------
describe("hasSpecialistMarker", () => {
  const envoyComment = { text: "[village] needs envoy: open PR" };
  const normalComment = { text: "Implementation complete." };
  const handoffComment = {
    text: "[handoff inspector→guard] Checks passed.",
  };

  test("detects envoy marker with specific specialist", () => {
    expect(hasSpecialistMarker([envoyComment], "envoy")).toBe(true);
  });

  test("detects any specialist marker without specific name", () => {
    expect(hasSpecialistMarker([envoyComment])).toBe(true);
  });

  test("returns false for normal comments", () => {
    expect(hasSpecialistMarker([normalComment])).toBe(false);
    expect(hasSpecialistMarker([normalComment], "envoy")).toBe(false);
  });

  test("returns false for handoff comments", () => {
    expect(hasSpecialistMarker([handoffComment])).toBe(false);
  });

  test("returns false for empty comments array", () => {
    expect(hasSpecialistMarker([])).toBe(false);
    expect(hasSpecialistMarker([], "envoy")).toBe(false);
  });

  test("returns false when specialist does not match", () => {
    expect(hasSpecialistMarker([envoyComment], "scribe")).toBe(false);
  });

  test("handles mixed comments — finds marker among normal ones", () => {
    expect(
      hasSpecialistMarker([normalComment, envoyComment, handoffComment]),
    ).toBe(true);
    expect(
      hasSpecialistMarker(
        [normalComment, envoyComment, handoffComment],
        "envoy",
      ),
    ).toBe(true);
  });

  test("handles comments with undefined text", () => {
    expect(hasSpecialistMarker([{ text: undefined }])).toBe(false);
  });

  test("detects marker without note suffix", () => {
    const bare = { text: "[village] needs envoy" };
    expect(hasSpecialistMarker([bare], "envoy")).toBe(true);
    expect(hasSpecialistMarker([bare])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSpecialistFromComment
// ---------------------------------------------------------------------------
describe("parseSpecialistFromComment", () => {
  test("parses envoy with note", () => {
    expect(
      parseSpecialistFromComment("[village] needs envoy: open PR"),
    ).toBe("envoy");
  });

  test("parses envoy without note", () => {
    expect(parseSpecialistFromComment("[village] needs envoy")).toBe("envoy");
  });

  test("returns undefined for non-marker text", () => {
    expect(parseSpecialistFromComment("Implementation complete.")).toBe(
      undefined,
    );
  });

  test("returns undefined for empty string", () => {
    expect(parseSpecialistFromComment("")).toBe(undefined);
  });

  test("returns undefined for handoff comment", () => {
    expect(
      parseSpecialistFromComment("[handoff worker→inspector] done"),
    ).toBe(undefined);
  });

  test("parses a hypothetical future specialist", () => {
    expect(
      parseSpecialistFromComment("[village] needs scribe: document API"),
    ).toBe("scribe");
  });
});

// ---------------------------------------------------------------------------
// selectFilteredReady — unit tests with mock comments
// ---------------------------------------------------------------------------
describe("selectFilteredReady", () => {
  // We can't easily call the real function since it fetches comments via br CLI.
  // Instead, we test the filtering logic through the pure helpers.
  // The integration test is covered by the hasSpecialistMarker tests above.

  // But we CAN test the concept: given a set of beads and their comments,
  // the default queue should skip specialist-tagged ones.

  test("default role skips specialist-tagged beads (conceptual)", () => {
    // Simulates the filtering logic that selectFilteredReady performs:
    const beads: BrIssue[] = [
      { id: "bead-1", title: "Tagged for envoy", priority: 1 },
      { id: "bead-2", title: "Normal task", priority: 2 },
    ];

    const commentsMap: Record<string, Array<{ text?: string }>> = {
      "bead-1": [{ text: "[village] needs envoy: open PR" }],
      "bead-2": [{ text: "Assigned to worker" }],
    };

    // Default role logic: iterate sorted beads, skip ones with specialist marker.
    let selected: BrIssue | null = null;
    for (const bead of beads) {
      const comments = commentsMap[bead.id] ?? [];
      if (hasSpecialistMarker(comments)) continue;
      selected = bead;
      break;
    }

    expect(selected).not.toBeNull();
    expect(selected!.id).toBe("bead-2");
  });

  test("specialist role only picks beads with matching marker (conceptual)", () => {
    const beads: BrIssue[] = [
      { id: "bead-1", title: "Tagged for envoy", priority: 1 },
      { id: "bead-2", title: "Normal task", priority: 2 },
    ];

    const commentsMap: Record<string, Array<{ text?: string }>> = {
      "bead-1": [{ text: "[village] needs envoy: open PR" }],
      "bead-2": [{ text: "Assigned to worker" }],
    };

    // Specialist role logic: iterate sorted beads, only pick ones with matching marker.
    let selected: BrIssue | null = null;
    for (const bead of beads) {
      const comments = commentsMap[bead.id] ?? [];
      if (hasSpecialistMarker(comments, "envoy")) {
        selected = bead;
        break;
      }
    }

    expect(selected).not.toBeNull();
    expect(selected!.id).toBe("bead-1");
  });

  test("default queue returns null when all beads are specialist-tagged (conceptual)", () => {
    const beads: BrIssue[] = [
      { id: "bead-1", title: "Tagged for envoy", priority: 1 },
    ];

    const commentsMap: Record<string, Array<{ text?: string }>> = {
      "bead-1": [{ text: "[village] needs envoy: open PR" }],
    };

    let selected: BrIssue | null = null;
    for (const bead of beads) {
      const comments = commentsMap[bead.id] ?? [];
      if (hasSpecialistMarker(comments)) continue;
      selected = bead;
      break;
    }

    expect(selected).toBeNull();
  });

  test("specialist returns null when no beads have matching marker (conceptual)", () => {
    const beads: BrIssue[] = [
      { id: "bead-1", title: "Normal task", priority: 1 },
    ];

    const commentsMap: Record<string, Array<{ text?: string }>> = {
      "bead-1": [{ text: "Just a regular comment" }],
    };

    let selected: BrIssue | null = null;
    for (const bead of beads) {
      const comments = commentsMap[bead.id] ?? [];
      if (hasSpecialistMarker(comments, "envoy")) {
        selected = bead;
        break;
      }
    }

    expect(selected).toBeNull();
  });
});
