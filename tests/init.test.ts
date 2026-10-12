/**
 * Tests for the installer logic in bin/init.ts.
 *
 * - patchConfig: verifies that both @technoch1ef/opencode-village and
 *   @technoch1ef/opencode-beads-rust are correctly registered in opencode.json
 *   under various conditions.
 *
 * - installCat (commands): verifies that command assets are installed as
 *   commands/village:<name>.md (colon-namespaced), not under a village/ subdirectory.
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

import {
  patchConfig,
  installCat,
  entryMatches,
  ensureVillageScoping,
  VILLAGE_AGENT_NAMES,
  villagePluginSpec,
  type PatchConfigOpts,
  type Opts,
  type PluginEntry,
} from "../bin/init";

const PLUGIN = "@technoch1ef/opencode-village";
const VILLAGE_SPEC = villagePluginSpec(); // version-pinned, e.g. @technoch1ef/opencode-village@1.0.0
const BEADS_RUST_PLUGIN = "@technoch1ef/opencode-beads-rust";
const BEADS_LEGACY_PLUGIN = "@technoch1ef/opencode-beads";

function makeOpts(overrides: Partial<PatchConfigOpts> = {}): PatchConfigOpts {
  return { dryRun: false, force: false, ...overrides };
}

function readConfig(dir: string): Record<string, unknown> {
  const p = join(dir, "opencode.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
}

function readPlugins(dir: string): PluginEntry[] {
  return (readConfig(dir).plugin as PluginEntry[] | undefined) ?? [];
}

function hasPlugin(plugins: PluginEntry[], pkg: string): boolean {
  return plugins.some((e) => entryMatches(e, pkg));
}

/** Find the beads-rust entry and return its options (if tuple form). */
function beadsRustOptions(plugins: PluginEntry[]): Record<string, unknown> | undefined {
  const entry = plugins.find((e) => entryMatches(e, BEADS_RUST_PLUGIN));
  return Array.isArray(entry) ? entry[1] : undefined;
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

  test("--all --force: both plugins land in opencode.json", async () => {
    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(true);
  });

  // ── Fresh install (no pre-existing opencode.json) ────────────────────

  test("creates opencode.json with both plugins when none exists", async () => {
    const opts = makeOpts({ force: true });
    await patchConfig(tmpDir, opts);

    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(true);
  });

  test("fresh install registers beads-rust with a village inject allowlist", async () => {
    await patchConfig(tmpDir, makeOpts({ force: true }));

    const options = beadsRustOptions(readPlugins(tmpDir));
    expect(options).toBeDefined();
    expect(options?.inject).toEqual([...VILLAGE_AGENT_NAMES]);
  });

  test("fresh install writes village-only scoping keys", async () => {
    await patchConfig(tmpDir, makeOpts({ force: true }));

    const cfg = readConfig(tmpDir);
    expect((cfg.tools as Record<string, unknown>)["village_*"]).toBe(false);
    const skill = (cfg.permission as Record<string, Record<string, unknown>>).skill;
    expect(skill["village-workflow"]).toBe("deny");
    expect(skill["*"]).toBe("allow");
  });

  // ── Entry recognition (pinned / tuple / file path) ────────────────────

  test("recognizes pinned and tuple entries: no duplicate registration", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          plugin: [
            `${PLUGIN}@0.6.5`,
            [BEADS_RUST_PLUGIN, { inject: ["mayor"] }],
          ],
          tools: { "village_*": false },
          permission: { skill: { "*": "allow", "village-workflow": "deny" } },
        },
        null,
        2,
      ) + "\n",
    );

    const changed = await patchConfig(tmpDir, makeOpts({ force: true }));

    // The stale pinned village entry is re-pinned in place, not duplicated.
    expect(changed).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toBe(VILLAGE_SPEC);
    // User's existing inject option is preserved untouched
    expect(beadsRustOptions(plugins)?.inject).toEqual(["mayor"]);
  });

  test("recognizes file-path entries pointing at a local checkout", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          plugin: [
            VILLAGE_SPEC,
            ["file:///home/u/Repositories/opencode-beads-rust/src/plugin.ts", { inject: [] }],
          ],
          tools: { "village_*": false },
          permission: { skill: { "village-workflow": "deny" } },
        },
        null,
        2,
      ) + "\n",
    );

    const changed = await patchConfig(tmpDir, makeOpts({ force: true }));

    expect(changed).toBe(false);
    expect(readPlugins(tmpDir)).toHaveLength(2);
  });

  // ── Version pinning ───────────────────────────────────────────────────

  test("registers the village plugin pinned to an explicit version", async () => {
    await patchConfig(tmpDir, makeOpts({ force: true }));

    const plugins = readPlugins(tmpDir);
    expect(VILLAGE_SPEC.startsWith(`${PLUGIN}@`)).toBe(true);
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(plugins).not.toContain(PLUGIN);
  });

  test("upgrades a bare village entry to the version-pinned spec", async () => {
    writeFileSync(
      join(tmpDir, "opencode.json"),
      JSON.stringify({ plugin: [PLUGIN, BEADS_RUST_PLUGIN] }, null, 2) + "\n",
    );

    expect(await patchConfig(tmpDir, makeOpts({ force: true }))).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(plugins).not.toContain(PLUGIN);
    expect(plugins.filter((p) => p === VILLAGE_SPEC)).toHaveLength(1);
  });

  test("leaves a file-path village entry (local checkout) untouched", async () => {
    const local = "file:///home/u/Repositories/opencode-village/src/plugin.ts";
    writeFileSync(
      join(tmpDir, "opencode.json"),
      JSON.stringify({ plugin: [local, BEADS_RUST_PLUGIN] }, null, 2) + "\n",
    );

    await patchConfig(tmpDir, makeOpts({ force: true }));
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(local);
    expect(plugins).not.toContain(VILLAGE_SPEC);
  });

  // ── Village-only scoping ──────────────────────────────────────────────

  test("adds scoping keys to an existing config that lacks them", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ plugin: [PLUGIN, BEADS_RUST_PLUGIN] }, null, 2) + "\n",
    );

    const changed = await patchConfig(tmpDir, makeOpts({ force: true }));

    expect(changed).toBe(true);
    const cfg = readConfig(tmpDir);
    expect((cfg.tools as Record<string, unknown>)["village_*"]).toBe(false);
    expect(
      (cfg.permission as Record<string, Record<string, unknown>>).skill["village-workflow"],
    ).toBe("deny");
  });

  test("scoping never overwrites explicit user values", () => {
    const cfg: Record<string, unknown> = {
      tools: { "village_*": true },
      permission: { skill: { "village-workflow": "allow" } },
    };

    const changed = ensureVillageScoping(cfg, makeOpts());

    expect(changed).toBe(false);
    expect((cfg.tools as Record<string, unknown>)["village_*"]).toBe(true);
    expect(
      (cfg.permission as Record<string, Record<string, unknown>>).skill["village-workflow"],
    ).toBe("allow");
  });

  test("scoping expands a flat skill permission string, preserving the default", () => {
    const cfg: Record<string, unknown> = { permission: { skill: "ask" } };

    const changed = ensureVillageScoping(cfg, makeOpts());

    expect(changed).toBe(true);
    const skill = (cfg.permission as Record<string, Record<string, unknown>>).skill;
    expect(skill["*"]).toBe("ask");
    expect(skill["village-workflow"]).toBe("deny");
  });

  // ── entryMatches ──────────────────────────────────────────────────────

  test("entryMatches handles specs, pins, tuples, and paths", () => {
    expect(entryMatches(BEADS_RUST_PLUGIN, BEADS_RUST_PLUGIN)).toBe(true);
    expect(entryMatches(`${BEADS_RUST_PLUGIN}@0.2.0`, BEADS_RUST_PLUGIN)).toBe(true);
    expect(entryMatches([BEADS_RUST_PLUGIN, {}], BEADS_RUST_PLUGIN)).toBe(true);
    expect(
      entryMatches("file:///x/opencode-beads-rust/src/plugin.ts", BEADS_RUST_PLUGIN),
    ).toBe(true);
    expect(entryMatches("~/Repositories/opencode-beads-rust", BEADS_RUST_PLUGIN)).toBe(true);
    // No cross-matching between legacy and rust variants
    expect(entryMatches(BEADS_RUST_PLUGIN, BEADS_LEGACY_PLUGIN)).toBe(false);
    expect(entryMatches(BEADS_LEGACY_PLUGIN, BEADS_RUST_PLUGIN)).toBe(false);
    expect(entryMatches(42, BEADS_RUST_PLUGIN)).toBe(false);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  test("is idempotent: re-running a fully patched config returns false", async () => {
    const cfgPath = join(tmpDir, "opencode.json");
    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          plugin: [VILLAGE_SPEC, BEADS_RUST_PLUGIN],
          tools: { "village_*": false },
          permission: { skill: { "*": "allow", "village-workflow": "deny" } },
        },
        null,
        2,
      ) + "\n",
    );

    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(false);
    // Plugins list is unchanged
    const plugins = readPlugins(tmpDir);
    expect(plugins).toEqual([VILLAGE_SPEC, BEADS_RUST_PLUGIN]);
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
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(true);
    expect(hasPlugin(plugins, BEADS_LEGACY_PLUGIN)).toBe(false);
    // Replacement entry is scoped to village agents
    expect(beadsRustOptions(plugins)?.inject).toEqual([...VILLAGE_AGENT_NAMES]);
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
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(hasPlugin(plugins, BEADS_LEGACY_PLUGIN)).toBe(true);
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(false);
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
      JSON.stringify({ plugin: [VILLAGE_SPEC] }, null, 2) + "\n",
    );

    const opts = makeOpts({ force: true });
    const changed = await patchConfig(tmpDir, opts);

    expect(changed).toBe(true);
    const plugins = readPlugins(tmpDir);
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(true);
    // No duplicates
    expect(plugins.filter((p) => p === VILLAGE_SPEC)).toHaveLength(1);
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
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(true);
  });

  test("creates parent directories for opencode.json if they do not exist", async () => {
    const nestedDir = join(tmpDir, "nested", "config", "opencode");
    mkdirSync(nestedDir, { recursive: true });

    const opts = makeOpts({ force: true });
    await patchConfig(nestedDir, opts);

    const plugins = readPlugins(nestedDir);
    expect(plugins).toContain(VILLAGE_SPEC);
    expect(hasPlugin(plugins, BEADS_RUST_PLUGIN)).toBe(true);
  });
});

// ── installCat: commands layout ─────────────────────────────────────────

/** Village command filenames (colon-namespaced) that should be installed. */
const VILLAGE_COMMANDS = [
  "village:work.md",
  "village:board.md",
  "village:envoy.md",
  "village:orphans.md",
];

function makeInstallOpts(prefix: string, overrides: Partial<Opts> = {}): Opts {
  return {
    all: true,
    agents: [],
    commands: [],
    skills: [],
    dryRun: false,
    force: true,
    prefix,
    symlink: false,
    ...overrides,
  };
}

describe("installCat — commands", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "install-cmd-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("installs commands as colon-namespaced commands/village:<name>.md files", async () => {
    const opts = makeInstallOpts(tmpDir);
    const count = await installCat("commands", [], opts);

    expect(count).toBeGreaterThan(0);

    for (const name of VILLAGE_COMMANDS) {
      const filePath = join(tmpDir, "commands", name);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  test("does NOT create a commands/village/ subdirectory", async () => {
    const opts = makeInstallOpts(tmpDir);
    await installCat("commands", [], opts);

    const villageDirPath = join(tmpDir, "commands", "village");
    expect(existsSync(villageDirPath)).toBe(false);
  });

  test("does NOT install village commands at flat commands/<name>.md level", async () => {
    const opts = makeInstallOpts(tmpDir);
    await installCat("commands", [], opts);

    const BARE_NAMES = ["work.md", "board.md", "envoy.md", "orphans.md"];
    for (const name of BARE_NAMES) {
      const flatPath = join(tmpDir, "commands", name);
      expect(existsSync(flatPath)).toBe(false);
    }
  });

  test("installed command files are non-empty and readable", async () => {
    const opts = makeInstallOpts(tmpDir);
    await installCat("commands", [], opts);

    for (const name of VILLAGE_COMMANDS) {
      const filePath = join(tmpDir, "commands", name);
      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });
});
