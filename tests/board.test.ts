import { describe, expect, test } from "bun:test";

import { epicChildIds } from "../src/tools/board";

describe("epicChildIds", () => {
  test("keeps only parent-child dependents", () => {
    const ids = epicChildIds({
      dependents: [
        { id: "bd-1.1", dependency_type: "parent-child" },
        { id: "bd-9", dependency_type: "blocks" },
      ],
    });
    expect([...ids!]).toEqual(["bd-1.1"]);
  });

  test("returns null without a dependents list", () => {
    expect(epicChildIds(undefined)).toBeNull();
    expect(epicChildIds({})).toBeNull();
  });
});
