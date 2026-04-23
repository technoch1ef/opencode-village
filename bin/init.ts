#!/usr/bin/env node
/**
 * opencode-village CLI installer.
 *
 * Copies (or symlinks) agents, commands, and skills from the package's
 * assets/ directory into the user's OpenCode config directory, and
 * registers the plugin in opencode.json.
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
const ASSETS = resolve(SELF, "..", "..", "assets");
const PLUGIN = "@technoch1ef/opencode-village";
const CATEGORIES = ["agents", "commands", "skills"] as const;
type Category = (typeof CATEGORIES)[number];

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

interface Opts {
  all: boolean;
  agents: string[];
  commands: string[];
  skills: string[];
  dryRun: boolean;
  force: boolean;
  prefix: string;
  symlink: boolean;
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

async function installCat(
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

function patchConfig(prefix: string, o: Opts): void {
  const p = join(prefix, "opencode.json");
  let cfg: Record<string, unknown>;

  if (existsSync(p)) {
    try {
      cfg = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    } catch {
      warn("Could not parse opencode.json; skipping plugin registration");
      return;
    }
  } else {
    cfg = { "$schema": "https://opencode.ai/config.json", plugin: [] };
  }

  const arr = Array.isArray(cfg.plugin) ? (cfg.plugin as string[]) : [];
  if (arr.includes(PLUGIN)) {
    log("\nopencode.json: plugin already registered");
    return;
  }

  arr.push(PLUGIN);
  cfg.plugin = arr;

  if (o.dryRun) {
    log(`\nopencode.json: would add "${PLUGIN}" to plugin array`);
    return;
  }

  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  log(`\nopencode.json: added "${PLUGIN}" to plugin array`);
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

  patchConfig(opts.prefix, opts);
  log(`\nDone: ${total} asset(s) installed${opts.dryRun ? " (dry-run)" : ""}`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e), 2));
