import { describe, expect, test } from "bun:test";

import {
  firstBrIssue,
  formatIssueLine,
  formatOrphansRow,
  AGENT_TO_ACTOR,
} from "../src/lib/br";

describe("AGENT_TO_ACTOR", () => {
  test("maps known agent names", () => {
    expect(AGENT_TO_ACTOR["mayor"]).toBe("mayor");
    expect(AGENT_TO_ACTOR["worker"]).toBe("worker");
    expect(AGENT_TO_ACTOR["inspector"]).toBe("inspector");
    expect(AGENT_TO_ACTOR["guard"]).toBe("guard");
    expect(AGENT_TO_ACTOR["envoy"]).toBe("envoy");
  });

  test("returns undefined for unknown agents", () => {
    expect(AGENT_TO_ACTOR["unknown"]).toBeUndefined();
  });
});

describe("formatIssueLine", () => {
  test("formats full issue", () => {
    const result = formatIssueLine({
      id: "abc-1",
      title: "Fix the  bug",
      status: "open",
    });
    expect(result).toBe("abc-1 | Fix the bug | open");
  });

  test("handles missing title and status", () => {
    const result = formatIssueLine({ id: "abc-2" });
    expect(result).toBe("abc-2 | (no title) | (no status)");
  });

  test("collapses whitespace in title", () => {
    const result = formatIssueLine({
      id: "abc-3",
      title: "  many   spaces  here  ",
      status: "closed",
    });
    expect(result).toBe("abc-3 | many spaces here | closed");
  });
});

describe("formatOrphansRow", () => {
  test("formats full issue with assignee", () => {
    const result = formatOrphansRow({
      id: "abc-1",
      title: "Task",
      status: "open",
      assignee: "worker",
    });
    expect(result).toBe("abc-1 | Task | open | worker");
  });

  test("handles missing assignee", () => {
    const result = formatOrphansRow({
      id: "abc-2",
      title: "Orphan",
      status: "open",
    });
    expect(result).toBe("abc-2 | Orphan | open | (unassigned)");
  });
});

describe("firstBrIssue", () => {
  test("extracts from a single object", () => {
    const issue = { id: "test-1", title: "Test" };
    expect(firstBrIssue(issue)).toEqual(issue);
  });

  test("extracts from a single-element array", () => {
    const issue = { id: "test-1", title: "Test" };
    expect(firstBrIssue([issue])).toEqual(issue);
  });

  test("extracts from a nested array", () => {
    const issue = { id: "test-1", title: "Test" };
    expect(firstBrIssue([[issue]])).toEqual(issue);
  });

  test("returns undefined for empty array", () => {
    expect(firstBrIssue([])).toBeUndefined();
  });

  test("returns undefined for null/undefined", () => {
    expect(firstBrIssue(null)).toBeUndefined();
    expect(firstBrIssue(undefined)).toBeUndefined();
  });

  test("returns undefined for object without id", () => {
    expect(firstBrIssue({ title: "No ID" })).toBeUndefined();
  });

  test("returns undefined for non-string id", () => {
    expect(firstBrIssue({ id: 123 })).toBeUndefined();
  });
});
