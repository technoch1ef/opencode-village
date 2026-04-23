import { describe, expect, test } from "bun:test";

import { isVillageSessionTitle } from "../src/lib/sessions";

describe("isVillageSessionTitle", () => {
  test("matches worker session titles", () => {
    expect(isVillageSessionTitle("village-worker-1")).toBe(true);
    expect(isVillageSessionTitle("village-worker-abc")).toBe(true);
  });

  test("matches inspector session titles", () => {
    expect(isVillageSessionTitle("village-inspector")).toBe(true);
    expect(isVillageSessionTitle("village-inspector-1")).toBe(true);
  });

  test("matches guard session titles", () => {
    expect(isVillageSessionTitle("village-guard")).toBe(true);
    expect(isVillageSessionTitle("village-guard-1")).toBe(true);
  });

  test("rejects non-village titles", () => {
    expect(isVillageSessionTitle("some-other-session")).toBe(false);
    expect(isVillageSessionTitle("village-mayor-1")).toBe(false);
    expect(isVillageSessionTitle("village-overseer")).toBe(false);
    expect(isVillageSessionTitle("")).toBe(false);
  });

  test("rejects non-string inputs", () => {
    expect(isVillageSessionTitle(null)).toBe(false);
    expect(isVillageSessionTitle(undefined)).toBe(false);
    expect(isVillageSessionTitle(123)).toBe(false);
  });
});
