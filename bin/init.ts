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
export async function patchConfig(prefix: string, o: PatchConfigOpts): Promise<boolean> {
  const p = join(prefix, "opencode.json");
  let cfg: Record<string, unknown>;

  if (existsSync(p)) {
    try {
      cfg = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    } catch {
      warn("Could not parse opencode.json; skipping plugin registration");
      return false;
    }
  } else {
    cfg = { "$schema": "https://opencode.ai/config.json", plugin: [] };
  }

  const arr = Array.isArray(cfg.plugin) ? [...(cfg.plugin as string[])] : [];
  let changed = false;

  // ── Register @technoch1ef/opencode-village ─────────────────────────
  if (arr.includes(PLUGIN)) {
    log("\nopencode.json: village plugin already registered");
  } else if (o.dryRun) {
    log(`\nopencode.json: would add "${PLUGIN}" to plugin array`);
  } else {
    arr.push(PLUGIN);
    changed = true;
    log(`\nopencode.json: added "${PLUGIN}" to plugin array`);
  }

  // ── Register @technoch1ef/opencode-beads-rust ──────────────────────
  if (arr.includes(BEADS_RUST_PLUGIN)) {
    log(`\nopencode.json: beads-rust plugin already registered`);
  } else {
    const hasLegacy = arr.includes(BEADS_LEGACY_PLUGIN);

    if (hasLegacy && o.force) {
      // --force: replace legacy without prompting
      if (o.dryRun) {
        log(`\nopencode.json: would replace "${BEADS_LEGACY_PLUGIN}" with "${BEADS_RUST_PLUGIN}" (--force)`);
      } else {
        const idx = arr.indexOf(BEADS_LEGACY_PLUGIN);
        arr.splice(idx, 1, BEADS_RUST_PLUGIN);
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
          const idx = arr.indexOf(BEADS_LEGACY_PLUGIN);
          arr.splice(idx, 1, BEADS_RUST_PLUGIN);
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
        arr.push(BEADS_RUST_PLUGIN);
        changed = true;
        log(`\nopencode.json: added "${BEADS_RUST_PLUGIN}" to plugin array`);
      }
    }
  }

  cfg.plugin = arr;

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
    log("  3. Run /village:work in a worker session");
  }
}

// Run main only when this file is the entry point.
// In Bun: import.meta.main is true when run directly, false when imported.
// In Node.js: import.meta.main is undefined → treat as direct execution.
const bunMain = (import.meta as unknown as Record<string, unknown>).main;
if (bunMain === true || bunMain === undefined) {
  main().catch((e) => die(e instanceof Error ? e.message : String(e), 2));
}
