#!/usr/bin/env bun
/**
 * Build script for @technoch1ef/opencode-village.
 *
 * Strategy
 * --------
 * JS emission is split into three bun build calls so each output is
 * separately optimised, and the "exports" map can resolve all entries:
 *
 *   bun build src/plugin.ts   → dist/plugin.js        (bundled; @opencode-ai/plugin external)
 *   bun build src/lib/shared.ts → dist/lib/shared.js  (needed for exports map "./lib/shared" entry)
 *   bun build bin/init.ts     → dist/bin/init.js       (CLI binary)
 *
 * Declaration (.d.ts) files are emitted by tsc --emitDeclarationOnly so
 * TypeScript consumers get accurate types without a full tsc compile.
 *
 * Shebang / chmod
 * ---------------
 * bun build strips the leading #!/usr/bin/env node comment.  We re-inject
 * it and mark the output executable so `npx opencode-village` works.
 */

import { $ } from "bun";

// ── helpers ──────────────────────────────────────────────────────────────

function step(msg: string) {
  console.log(`\n▶ ${msg}`);
}

// ── clean ────────────────────────────────────────────────────────────────

step("clean dist/");
await $`rm -rf dist`;

// ── JS: plugin (bundled, peer dep kept external) ─────────────────────────

step("bun build src/plugin.ts → dist/plugin.js");
await $`bun build src/plugin.ts --target=node --outdir=dist --format=esm --external @opencode-ai/plugin`;

// ── JS: lib/shared (separate entry required by "exports" map) ────────────

step("bun build src/lib/shared.ts → dist/lib/shared.js");
await $`bun build src/lib/shared.ts --target=node --outdir=dist/lib --format=esm`;

// ── JS: CLI binary ───────────────────────────────────────────────────────

step("bun build bin/init.ts → dist/bin/init.js");
await $`bun build bin/init.ts --target=node --outdir=dist/bin --format=esm`;

// ── shebang + chmod ──────────────────────────────────────────────────────

step("ensure shebang + chmod +x on dist/bin/init.js");
const initPath = "dist/bin/init.js";
const initText = await Bun.file(initPath).text();
if (!initText.startsWith("#!/usr/bin/env node")) {
  await Bun.write(initPath, `#!/usr/bin/env node\n${initText}`);
  console.log("  injected #!/usr/bin/env node shebang");
} else {
  console.log("  shebang already present");
}
await $`chmod +x ${initPath}`;

// ── declarations: src/ ───────────────────────────────────────────────────

step("tsc --emitDeclarationOnly → dist/**/*.d.ts  (plugin, lib, tools, detect)");
await $`bun x tsc -p tsconfig.json --emitDeclarationOnly --outDir dist`;

// ── declarations: bin/ ───────────────────────────────────────────────────
// tsconfig.bin.json sets declaration:false because the legacy build emitted
// JS via tsc; override that here since we only want .d.ts output.

step("tsc --emitDeclarationOnly → dist/bin/init.d.ts");
await $`bun x tsc -p tsconfig.bin.json --declaration --emitDeclarationOnly --outDir dist/bin`;

// ── done ─────────────────────────────────────────────────────────────────

step("build complete ✓");
