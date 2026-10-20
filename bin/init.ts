#!/usr/bin/env node
/**
 * opencode-village CLI installer.
 *
 * Copies (or symlinks) agents, commands, and skills from the package's
 * assets/ directory into the user's OpenCode config directory, and
 * registers the plugin(s) in opencode.json.
 *
 * Usage:
 *   npx @technoch1ef/opencode-village init --all
 *   npx @technoch1ef/opencode-village init --agents mayor,worker
 *   npx @technoch1ef/opencode-village init --dry-run
 */
import {
  copyFileSync, existsSync, lstatSync, mkdirSync,
  readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// ── Constants ──────────────────────────────────────────────────────────

const SELF = dirname(fileURLToPath(import.meta.url));
// From dist: dist/bin/init.js → ../.. → package root
// From source: bin/init.ts   → ..    → package root
const ASSETS = existsSync(resolve(SELF, "..", "assets"))
  ? resolve(SELF, "..", "assets")
  : resolve(SELF, "..", "..", "assets");
const PLUGIN = "@technoch1ef/opencode-village";
const BEADS_RUST_PLUGIN = "@technoch1ef/opencode-beads-rust";
const BEADS_LEGACY_PLUGIN = "@technoch1ef/opencode-beads";

// Package root, resolved for both the published (dist/bin/) and source (bin/)
// layouts — mirrors the ASSETS detection above.
const PKG_ROOT = existsSync(resolve(SELF, "..", "assets"))
  ? resolve(SELF, "..")          // source layout: bin/  → ..
  : resolve(SELF, "..", "..");   // dist layout:   dist/bin/ → ../..

/**
 * The exact, version-pinned plugin spec to register in opencode.json
 * (e.g. `@technoch1ef/opencode-village@1.0.0`).
 *
 * OpenCode caches plugins by their exact spec string, freezing the resolved
 * version of a bare/`@latest` entry forever. Pinning the version the package
 * actually ships ensures every upgrade changes the cache key, so OpenCode
 * loads the new code instead of a stale cached copy.
 *
 * Falls back to the bare plugin name if the version can't be read, so a
 * malformed package.json never breaks installation.
 */
export function villagePluginSpec(): string {
  try {
    const { version } = JSON.parse(
      readFileSync(join(PKG_ROOT, "package.json"), "utf-8"),
    ) as { version?: string };
    return version ? `${PLUGIN}@${version}` : PLUGIN;
  } catch {
    return PLUGIN;
  }
}

/**
 * Village role agent names. Used to scope beads context injection: the
 * beads-rust plugin is registered with an `inject` allowlist so that only
 * village roles (plus its own beads-task-agent) receive `br prime` context.
 * Default agents (build/plan/explore/general) stay beads-unaware.
 */
export const VILLAGE_AGENT_NAMES = [
  "mayor",
  "worker",
  "guard",
  "inspector",
  "envoy",
] as const;
export const CATEGORIES = ["agents", "commands", "skills"] as const;
export type Category = (typeof CATEGORIES)[number];

// ── IO helpers ─────────────────────────────────────────────────────────

const log = (m: string) => process.stdout.write(m + "\n");
const warn = (m: string) => process.stderr.write(`warn: ${m}\n`);
const die = (m: string, code: number): never => {
  process.stderr.write(`error: ${m}\n`);
  process.exit(code);
};

function ask(q: string): Promise<string> {
  if (!process.stdin.isTTY) return Promise.resolve("y");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((res) => {
    rl.question(q, (a) => { rl.close(); res(a.trim()); });
    rl.once("close", () => res(""));
  });
}

async function confirm(q: string): Promise<boolean> {
  const a = await ask(`${q} [Y/n] `);
  return a === "" || /^y(es)?$/i.test(a);
}

/**
 * Prompt with a default of "no". In non-interactive (non-TTY) environments
 * the conservative default (false / no) is returned immediately.
 */
async function confirmNo(q: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((res) => {
    rl.question(`${q} [y/N] `, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())); });
    rl.once("close", () => res(false));
  });
}

// ── FS helpers ─────────────────────────────────────────────────────────

function cpDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name);
    e.isDirectory() ? cpDir(s, d) : copyFileSync(s, d);
  }
}

function listAssets(cat: Category): string[] {
  const d = join(ASSETS, cat);
  return existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith(".")) : [];
}

// ── Arg parsing ────────────────────────────────────────────────────────

export interface Opts {
  all: boolean;
  agents: string[];
  commands: string[];
  skills: string[];
  dryRun: boolean;
  force: boolean;
  prefix: string;
  symlink: boolean;
}

/** Minimal subset of Opts consumed by patchConfig (exported for tests). */
export interface PatchConfigOpts {
  dryRun: boolean;
  force: boolean;
}

function defaultPrefix(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return join(xdg ?? join(home, ".config"), "opencode");
}

function usage(): string {
  return [
    "Usage: opencode-village [init] [options]",
    "",
    "Options:",
    "  --all                Install all agents, commands, and skills",
    "  --agents <csv>       Install specific agents (comma-separated)",
    "  --commands <csv>     Install specific commands (comma-separated)",
    "  --skills <csv>       Install specific skills (comma-separated)",
    "  --prefix <path>      Config directory (default: ~/.config/opencode)",
    "  --dry-run            Show planned operations without writing",
    "  --force              Overwrite existing files without prompting",
    "  --symlink            Create symlinks instead of copies",
    "  -h, --help           Show this help",
  ].join("\n");
}

function parseArgs(raw: string[]): Opts {
  const o: Opts = {
    all: false, agents: [], commands: [], skills: [],
    dryRun: false, force: false, prefix: defaultPrefix(), symlink: false,
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    switch (a) {
      case "init":       break;
      case "--all":      o.all = true; break;
      case "--dry-run":  o.dryRun = true; break;
      case "--force":    o.force = true; break;
      case "--symlink":  o.symlink = true; break;
      case "--agents":   o.agents   = (raw[++i] ?? "").split(",").filter(Boolean); break;
      case "--commands": o.commands = (raw[++i] ?? "").split(",").filter(Boolean); break;
      case "--skills":   o.skills   = (raw[++i] ?? "").split(",").filter(Boolean); break;
      case "--prefix":   o.prefix   = raw[++i] ?? o.prefix; break;
      case "-h": case "--help": log(usage()); process.exit(0);
      default:
        if (a.startsWith("-")) die(`Unknown flag: ${a}`, 1);
    }
  }
  return o;
}

// ── Install logic ──────────────────────────────────────────────────────

async function place(
  src: string, dst: string, label: string, o: Opts,
): Promise<boolean> {
  const exists = existsSync(dst);

  if (exists && !o.force) {
    if (o.dryRun) { log(`  [skip] ${label} (exists, use --force)`); return false; }
    if (!(await confirm(`  Overwrite ${label}?`))) {
      log(`  [skip] ${label}`);
      return false;
    }
  }

  const verb = o.symlink ? "link" : "copy";
  if (o.dryRun) { log(`  [${verb}] ${label}`); return true; }

  if (exists) rmSync(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });

  if (o.symlink) {
    symlinkSync(src, dst);
  } else if (lstatSync(src).isDirectory()) {
    cpDir(src, dst);
  } else {
    copyFileSync(src, dst);
  }
  log(`  [${verb}] ${label}`);
  return true;
}

export async function installCat(
  cat: Category, names: string[], o: Opts,
): Promise<number> {
  const avail = listAssets(cat);
  if (!avail.length) { warn(`No ${cat} assets found in package`); return 0; }

  // Resolve user-provided names to actual asset entries (with/without .md)
  const selected = names.length
    ? names.map((n) => avail.find((a) => a === n || a === `${n}.md`) ?? n)
    : avail;

  log(`\n${cat}:`);
  let count = 0;
  for (const name of selected) {
    const src = join(ASSETS, cat, name);
    const dst = join(o.prefix, cat, name);
    if (!existsSync(src)) { warn(`  Not found: ${cat}/${name}`); continue; }
    if (await place(src, dst, `${cat}/${name}`, o)) count++;
  }
  return count;
}

// ── opencode.json update ───────────────────────────────────────────────

/**
 * Ensures both `@technoch1ef/opencode-village` and
 * `@technoch1ef/opencode-beads-rust` are registered in opencode.json.
 *
 * Conflict handling:
 *   - If `opencode-beads` (legacy `bd` variant) is present and
 *     `opencode-beads-rust` is absent, a warning is printed and the user
 *     is asked whether to replace it (default: no, leave as-is).
 *   - `--force` skips the prompt and replaces unconditionally.
 *
 * Returns `true` if opencode.json was actually written.
 */

/** A plugin array entry: npm spec / file path, or a `[spec, options]` tuple. */
export type PluginEntry = string | [string, Record<string, unknown>];

/**
 * Does a plugin entry reference the given package?
 *
 * Recognizes, for both plain-string and `[spec, options]` tuple entries:
 *   - exact npm name:           `@scope/pkg`
 *   - pinned npm spec:          `@scope/pkg@1.2.3`
 *   - file/path entries into a local checkout: `file:///…/pkg/src/plugin.ts`
 */
export function entryMatches(entry: unknown, pkg: string): boolean {
  const spec = Array.isArray(entry) ? entry[0] : entry;
  if (typeof spec !== "string") return false;
  if (spec === pkg || spec.startsWith(`${pkg}@`)) return true;
  const bareName = pkg.split("/").pop() ?? pkg;
  return spec.includes(`/${bareName}/`) || spec.endsWith(`/${bareName}`);
}

/** The beads-rust entry registered on fresh installs: scoped to village roles. */
function beadsRustEntry(): PluginEntry {
  return [BEADS_RUST_PLUGIN, { inject: [...VILLAGE_AGENT_NAMES] }];
}

/**
 * Ensure village-only scoping keys in opencode.json:
 *
 *   - `tools["village_*"] = false` — hide village tools from all agents;
 *     the installed village agents re-enable them via frontmatter
 *     (`"village_*": true`).
 *   - `permission.skill["village-workflow"] = "deny"` — block the skill for
 *     non-village agents; village agents re-allow it via frontmatter.
 *
 * Existing user values are never overwritten. Returns true if cfg changed.
 */
export function ensureVillageScoping(
  cfg: Record<string, unknown>,
  o: PatchConfigOpts,
): boolean {
  let changed = false;

  // tools["village_*"] = false
  const tools = (cfg.tools ?? {}) as Record<string, unknown>;
  if (!("village_*" in tools)) {
    if (o.dryRun) {
      log(`opencode.json: would set tools["village_*"] = false (village-only scoping)`);
    } else {
      tools["village_*"] = false;
      cfg.tools = tools;
      changed = true;
      log(`opencode.json: set tools["village_*"] = false (village-only scoping)`);
    }
  }

  // permission.skill["village-workflow"] = "deny"
  const permission = (cfg.permission ?? {}) as Record<string, unknown>;
  const skill = permission.skill;
  let nextSkill: Record<string, unknown> | undefined;
  if (skill === undefined) {
    nextSkill = { "*": "allow", "village-workflow": "deny" };
  } else if (typeof skill === "string") {
    // Flat action shorthand — expand, preserving the user's default.
    nextSkill = { "*": skill, "village-workflow": "deny" };
  } else if (
    typeof skill === "object" &&
    skill !== null &&
    !("village-workflow" in (skill as Record<string, unknown>))
  ) {
    nextSkill = { ...(skill as Record<string, unknown>), "village-workflow": "deny" };
  }
  if (nextSkill) {
    if (o.dryRun) {
      log(`opencode.json: would set permission.skill["village-workflow"] = "deny"`);
    } else {
      permission.skill = nextSkill;
      cfg.permission = permission;
      changed = true;
      log(`opencode.json: set permission.skill["village-workflow"] = "deny"`);
    }
  }

  return changed;
}

export async function patchConfig(prefix: string, o: PatchConfigOpts): Promise<boolean> {
  const p = join(prefix, "opencode.json");
  let cfg: Record<string, unknown>;

  if (existsSync(p)) {
    try {
      cfg = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    } catch {
      warn("Could not parse opencode.json; skipping plugin registration");
      warn("(note: JSONC comments/trailing commas are not supported by the installer — patch manually)");
      return false;
    }
  } else {
    cfg = { "$schema": "https://opencode.ai/config.json", plugin: [] };
  }

  const arr = Array.isArray(cfg.plugin) ? [...(cfg.plugin as PluginEntry[])] : [];
  let changed = false;

  // ── Register @technoch1ef/opencode-village (version-pinned) ────────
  // npm entries (bare or pinned) are re-pinned to the current version, keeping
  // tuple options; file-path entries (local checkouts) are left untouched.
  const spec = villagePluginSpec();
  const villageIdx = arr.findIndex((e) => entryMatches(e, PLUGIN));
  const current = villageIdx === -1 ? undefined : arr[villageIdx];
  const currentSpec = Array.isArray(current) ? current[0] : current;
  if (current !== undefined && (currentSpec === spec || !currentSpec?.startsWith(PLUGIN))) {
    log("\nopencode.json: village plugin already registered at current version");
  } else if (o.dryRun) {
    log(
      current !== undefined
        ? `\nopencode.json: would update village plugin to "${spec}"`
        : `\nopencode.json: would add "${spec}" to plugin array`,
    );
  } else {
    if (current !== undefined) {
      arr.splice(villageIdx, 1, Array.isArray(current) ? [spec, current[1]] : spec);
      log(`\nopencode.json: updated village plugin to "${spec}"`);
    } else {
      arr.push(spec);
      log(`\nopencode.json: added "${spec}" to plugin array`);
    }
    changed = true;
  }

  // ── Register @technoch1ef/opencode-beads-rust ──────────────────────
  // Fresh registrations use the tuple form with a village-role `inject`
  // allowlist so beads context never leaks into build/plan/custom agents.
  if (arr.some((e) => entryMatches(e, BEADS_RUST_PLUGIN))) {
    log(`\nopencode.json: beads-rust plugin already registered`);
  } else {
    const legacyIdx = arr.findIndex(
      (e) => entryMatches(e, BEADS_LEGACY_PLUGIN) && !entryMatches(e, BEADS_RUST_PLUGIN),
    );
    const hasLegacy = legacyIdx !== -1;

    if (hasLegacy && o.force) {
      // --force: replace legacy without prompting
      if (o.dryRun) {
        log(`\nopencode.json: would replace "${BEADS_LEGACY_PLUGIN}" with "${BEADS_RUST_PLUGIN}" (--force)`);
      } else {
        arr.splice(legacyIdx, 1, beadsRustEntry());
        changed = true;
        log(`\nopencode.json: replaced "${BEADS_LEGACY_PLUGIN}" with "${BEADS_RUST_PLUGIN}" (--force)`);
      }
    } else if (hasLegacy) {
      // Conflict: ask user (default no)
      warn(`Conflict detected: "${BEADS_LEGACY_PLUGIN}" is already registered.`);
      warn(`"${BEADS_RUST_PLUGIN}" (the new \`br\` CLI) conflicts with it.`);
      warn(`Use --force to replace automatically, or edit opencode.json manually.`);

      if (o.dryRun) {
        log(`\nopencode.json: would skip "${BEADS_RUST_PLUGIN}" (conflict with "${BEADS_LEGACY_PLUGIN}"; re-run with --force to replace)`);
      } else {
        const replace = await confirmNo(
          `  Replace "${BEADS_LEGACY_PLUGIN}" with "${BEADS_RUST_PLUGIN}"?`,
        );
        if (replace) {
          arr.splice(legacyIdx, 1, beadsRustEntry());
          changed = true;
          log(`\nopencode.json: replaced "${BEADS_LEGACY_PLUGIN}" with "${BEADS_RUST_PLUGIN}"`);
        } else {
          log(`\nopencode.json: left "${BEADS_LEGACY_PLUGIN}" as-is (re-run with --force to replace)`);
        }
      }
    } else {
      // No conflict – just add
      if (o.dryRun) {
        log(`\nopencode.json: would add "${BEADS_RUST_PLUGIN}" to plugin array`);
      } else {
        arr.push(beadsRustEntry());
        changed = true;
        log(`\nopencode.json: added "${BEADS_RUST_PLUGIN}" (inject scoped to village agents) to plugin array`);
      }
    }
  }

  cfg.plugin = arr;

  // ── Village-only scoping (tools + skill permission) ────────────────
  if (ensureVillageScoping(cfg, o)) changed = true;

  if (!o.dryRun && changed) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  }

  return changed;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.on("SIGINT", () => { log("\nAborted."); process.exit(1); });

  const opts = parseArgs(process.argv.slice(2));
  const hasSpecific =
    opts.agents.length + opts.commands.length + opts.skills.length > 0;
  const interactive = !opts.all && !hasSpecific;

  log("opencode-village installer");
  log(`prefix: ${opts.prefix}`);
  if (opts.dryRun) log("(dry-run mode)");
  if (opts.symlink) log("(symlink mode)");

  if (!existsSync(ASSETS)) die(`Assets not found: ${ASSETS}`, 2);

  let total = 0;

  for (const cat of CATEGORIES) {
    const picked = opts[cat as "agents" | "commands" | "skills"];

    // In specific mode, skip categories the user didn't request
    if (hasSpecific && !picked.length) continue;

    // In interactive mode, show what's available and ask
    if (interactive) {
      const avail = listAssets(cat);
      if (!avail.length) continue;
      log(`\nAvailable ${cat}: ${avail.join(", ")}`);
      if (!(await confirm(`Install ${cat}?`))) continue;
    }

    total += await installCat(
      cat,
      opts.all || interactive ? [] : picked,
      opts,
    );
  }

  const changed = await patchConfig(opts.prefix, opts);
  log(`\nDone: ${total} asset(s) installed${opts.dryRun ? " (dry-run)" : ""}`);

  if (!opts.dryRun && (total > 0 || changed)) {
    log("\nNext steps:");
    log("  1. Install the br CLI: https://github.com/Dicklesworthstone/beads_rust");
    log("  2. Restart OpenCode");
    log("  3. Plan an epic with the mayor agent, then run /village:work");
  }
}

// Run main only when this file is the entry point.
// In Bun: import.meta.main is true when run directly, false when imported.
// In Node.js: import.meta.main is undefined → treat as direct execution.
const bunMain = (import.meta as unknown as Record<string, unknown>).main;
if (bunMain === true || bunMain === undefined) {
  main().catch((e) => die(e instanceof Error ? e.message : String(e), 2));
}
