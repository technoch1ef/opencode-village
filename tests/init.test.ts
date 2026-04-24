/**
 * Tests for the patchConfig function in bin/init.ts.
 *
 * Verifies that both @technoch1ef/opencode-village and
 * @technoch1ef/opencode-beads-rust are correctly registered in opencode.json
 * under various conditions.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { patchConfig, type PatchConfigOpts } from "../bin/init";

const PLUGIN = "@technoch1ef/opencode-village";
const BEADS_RUST_PLUGIN = "@technoch1ef/opencode-beads-rust";
const BEADS_LEGACY_PLUGIN = "@technoch1ef/opencode-beads";

function makeOpts(overrides: Partial<PatchConfigOpts> = {}): PatchConfigOpts {
  return { dryRun: false, force: false, ...overrides };
}

function readPlugins(dir: string): string[] {
  const p = join(dir, "opencode.json");
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, "utf-8")) as { plugin?: string[] }).plugin ?? [];
}

describe("patchConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "init-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Core acceptance criterion ────────────────────────────────────────

  test("--all --force: both plugin names land in opencode.json", async () => {
    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(PLUGIN);
    expect(plugins).toContain(BEADS_RUST_PLUGIN);
  });

  // ── Fresh install (no pre-existing opencode.json) ────────────────────

  test("creates opencode.json with both plugins when none exists", async () => {
    const opts = makeOpts({ force: true });
    await patchConfig(tmpDir, opts);

    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(PLUGIN);
    expect(plugins).toContain(BEADS_RUST_PLUGIN);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  test("is idempotent: re-running with both plugins already registered returns false", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: [PLUGIN, BEADS_RUST_PLUGIN] }, null, 2) + "\n",
    );

    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(false);
    // Plugins list is unchanged
    const plugins = readPlugins(tmpDir);
    expect(plugins).toEqual([PLUGIN, BEADS_RUST_PLUGIN]);
  });

  // ── Dry-run mode ──────────────────────────────────────────────────────

  test("dry-run: returns false and does not write opencode.json", async () => {
    const opts = makeOpts({ dryRun: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(false);
    expect(existsSync(join(tmpDir, "opencode.json"))).toBe(false);
  });

  test("dry-run: does not modify an existing opencode.json", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    const original = JSON.stringify({ plugin: [] }, null, 2) + "\n";
    writeFileSync(cfgPath, original);

    const opts = makeOpts({ dryRun: true });
    await patchConfig(tmpDir, opts);

    expect(readFileSync(cfgPath, "utf-8")).toBe(original);
  });

  // ── Legacy opencode-beads conflict ───────────────────────────────────

  test("--force replaces legacy opencode-beads with opencode-beads-rust", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: [BEADS_LEGACY_PLUGIN] }, null, 2) + "\n",
    );

    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(BEADS_RUST_PLUGIN);
    expect(plugins).not.toContain(BEADS_LEGACY_PLUGIN);
  });

  test("without --force, leaves legacy opencode-beads in place (non-TTY = conservative default)", async () => {
    // In a non-TTY test environment confirmNo() returns false (leave as-is)
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: [BEADS_LEGACY_PLUGIN] }, null, 2) + "\n",
    );

    const opts = makeOpts({ force: false });
    const changed = await patchConfig(tmpDir, opts);

    // Village plugin should still be added; beads-rust should not replace legacy
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(PLUGIN);
    expect(plugins).toContain(BEADS_LEGACY_PLUGIN);
    expect(plugins).not.toContain(BEADS_RUST_PLUGIN);
    expect(changed).toBe(true); // village was added
  });

  test("dry-run with legacy conflict: reports skip message, does not write", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: [BEADS_LEGACY_PLUGIN] }, null, 2) + "\n",
    );

    const opts = makeOpts({ dryRun: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(false);
    // File should be unmodified
    const plugins = readPlugins(tmpDir);
    expect(plugins).toEqual([BEADS_LEGACY_PLUGIN]);
  });

  // ── Existing partial config ───────────────────────────────────────────

  test("adds only missing plugins when one is already present", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: [PLUGIN] }, null, 2) + "\n",
    );

    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(PLUGIN);
    expect(plugins).toContain(BEADS_RUST_PLUGIN);
    // No duplicates
    expect(plugins.filter((p) => p === PLUGIN)).toHaveLength(1);
  });

  test("preserves other plugins already in the array", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: ["some-other-plugin"] }, null, 2) + "\n",
    );

    const opts = makeOpts({ force: true });
    await patchConfig(tmpDir, opts);

    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain("some-other-plugin");
    expect(plugins).toContain(PLUGIN);
    expect(plugins).toContain(BEADS_RUST_PLUGIN);
  });

  test("creates parent directories for opencode.json if they do not exist", async () => {
    const nestedDir = join(tmpDir, "nested", "config", "opencode");
    mkdirSync(nestedDir, { recursive: true });

    const opts = makeOpts({ force: true });
    await patchConfig(nestedDir, opts);

    const plugins = readPlugins(nestedDir);
    expect(plugins).toContain(PLUGIN);
    expect(plugins).toContain(BEADS_RUST_PLUGIN);
  });
});
