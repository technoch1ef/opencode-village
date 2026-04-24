# Changelog

## 0.1.1

### Fixed

- **Commands now install under `commands/village/` namespace**: the `init --all` installer places command files into `commands/village/{work,board,envoy,orphans}.md` instead of flat `commands/*.md`. This fixes missing slash commands on fresh installs where OpenCode expects a subdirectory layout for namespaced `/village:*` commands.
- **Asset path resolution**: `ASSETS` constant now resolves correctly from both source (`bin/init.ts`) and dist (`dist/bin/init.js`), fixing test failures when running from the repository root.

### Docs

- README.md commands table updated with all four `/village:*` commands.
- VILLAGE.md rewritten to reflect the 5-role architecture, namespaced commands table, and `commands/village/` subdirectory convention.

### Upgrade note

Existing users who installed 0.1.0 should re-run `npx @technoch1ef/opencode-village@latest init --all --force` to overwrite stale flat command files. Alternatively, manually delete any `commands/work.md`, `commands/board.md`, `commands/envoy.md`, `commands/orphans.md` files and re-run `init --all`.

## 0.1.0

Initial release of `@technoch1ef/opencode-village`.

### Features

- **Role-driven workflow**: mayor, worker, inspector, guard, envoy with structured handoff chain
- **Beads integration**: AI-native issue tracking with `br` CLI via `village_claim`, `village_handoff`, `village_scaffold`
- **Stack auto-detection**: automatically detects TypeScript, Solana/Anchor, and Ruby on Rails from filesystem signals
- **Bead body linter**: rejects incomplete beads at creation time (`village_lint`, scaffold pre-validation)
- **CLI installer**: `npx @technoch1ef/opencode-village init --all` copies agents, commands, and skills into OpenCode config
- **Tools**: `village_claim`, `village_handoff`, `village_scaffold`, `village_lint`, `village_board`, `village_detect_stack`, `village_ensure_branch`, `village_orphans`, `village_status`, `village_worktrees`
- **Commands**: `/village:work`, `/village:orphans`
- **Skills**: `beads-workflow`, `stack-typescript`, `stack-solana`, `stack-ruby-on-rails` (each with review checklists)
- **Monorepo support**: stack detection walks to repo root and scans `packages/*`
- **Worktree support**: parallel village sessions via git worktrees with conflict detection
