# Changelog

## 0.6.5

### Fixed

- **Agent permission rules no longer fight the agents' own prompts**: OpenCode resolves bash permission rules with last-match-wins semantics, but every agent's frontmatter listed specific `allow` carve-outs *before* the broad `deny` rules (`git branch*`, `git merge*`, `git fetch*`, `gh *`) — so the denies always won and the carve-outs were dead rules. In practice this denied the exact read-only commands the prompts instruct the roles to run:
  - `git branch --show-current` — the orientation step in every role's work loop (blocked ~30×/month in real usage, and it poisoned chained calls like `git status && git branch --show-current`).
  - `git merge-base` — inspector's documented diff-gathering step (`git diff $(git merge-base HEAD main)..HEAD`), caught by `git merge*`.
  - `git fetch origin` / `git fetch origin *` — worker's and envoy's read-only remote refresh, caught by `git fetch*`.
  - `gh pr view*` / `gh pr diff*` / `gh issue*` — inspector's PR review commands, caught by `gh *`.
  - `git checkout -b epic/*`, `git switch -c epic/*` — worker's allowed epic-branch creation, caught by the generic `-b`/`-c` denies.
  - `git merge origin/main --ff-only` — worker's allowed fast-forward refresh, caught by `git merge*`.

  All five agent permission blocks (worker, guard, inspector, mayor, envoy) are now ordered least-specific → most-specific so carve-outs actually take precedence, with an inline comment documenting the last-match-wins contract. New explicit read-only allows were added where the corresponding broad deny exists: `git branch --show-current*`, `git branch --list*`, `git merge-base*`.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to refresh the agent prompts. If you previously hand-patched installed agents to work around denied read-only git/gh commands, the refreshed assets supersede those workarounds.

## 0.6.4

### Fixed

- **Epics can no longer wedge the village**: a worker (or any role) that mis-set an epic bead to `in_progress`/assigned could stall the pipeline — `village_claim` would "claim" the epic ahead of real child tasks and stamp a worktree comment on it, and `checkWorktreeConflict` would then report a phantom `worktree_conflict` that blocked guard from claiming in the same worktree. The plugin now treats epics as containers, never as claimable work:
  - `village_claim` / `selectFilteredReady` skip any bead with `issue_type === "epic"`, and an in-progress epic no longer counts as a role's active bead (so it can't trigger the single/multiple in_progress guard).
  - `checkWorktreeConflict` ignores in-progress epics, eliminating the phantom conflict.
  - The worker agent prompt now explicitly forbids modifying epic beads (status/assignee); epic *branches* remain git-only.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to refresh the worker agent prompt.

## 0.6.3

### Fixed

- **Worker can return a bead to the mayor**: `village_handoff` previously rejected `worker → mayor` (allowed targets were `guard` only), leaving a blocked worker with no way to hand work back for rescoping. `worker → mayor` is now permitted and always forced to `status=blocked` (passing any other status throws). The worker agent's "When blocked" guidance now instructs returning the bead via `village_handoff` instead of just commenting.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to refresh the worker agent prompt.

## 0.5.0

### Removed

- **All `stack-*` references**: removed remaining mentions of stack skills from agent prompts (mayor/guard/inspector), the `village-workflow` skill, the inspector work-loop prompt in `src/lib/shared.ts`, README, and tests. Stack-specific guidance is gone — agents now reference whatever skills the bead lists or that `<available_skills>` exposes.

### Changed

- **Skill consolidation**: `beads-workflow`, `handoff`, and `grill-me` skills are gone. The new `village-workflow` skill subsumes the first two (workflow conventions + cross-repo handoff template). Mayor stress-testing previously delegated to `grill-me` is now inlined in `agents/mayor.md`.
- **Tools-first language**: agent prompts, commands, and skills no longer reference the `br` CLI directly. All village operations go through `village_*` plugin tools; `br` remains the internal backing store invoked by the plugin.
- **Bead bodies**: `## Skills` should now list `village-workflow` (was `beads-workflow`). `village_scaffold` injects the new name automatically.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to install the new skill, refreshed agents, and updated commands.

## 0.4.0

### Changed

- **Handoff chain reordered**: `worker → guard → inspector` (was `worker → inspector → guard`). Guard (CI) runs before inspector (code review) to save LLM credits on broken builds.
- **Guard** is no longer the terminal closer — it hands off to inspector on green.
- **Inspector** is now the terminal closer — closes beads on approval, handles epic cascade close and envoy dispatch.
- **Worker** hands off to guard (was inspector).

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to update agent prompts with the new chain order.

## 0.3.0

### Removed

- **`village_detect_stack` tool**: stack detection is no longer built into the plugin. Stack skills are now discovered natively by OpenCode via `<available_skills>`.
- **`src/detect/stack.ts` module**: filesystem signal checkers for TypeScript and Rails removed.

### Changed

- **`village_scaffold`** no longer auto-injects stack skills. The mayor specifies them explicitly when creating beads.
- **Agent prompts** now reference `<available_skills>` for dynamic stack discovery instead of hardcoded detection logic.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to update agent prompts. Install stack skills (e.g. `stack-typescript`) into your skills directory — agents will pick them up automatically.

## 0.1.3

### Removed

- **Solana stack support**: removed `stack-solana` skill asset, Solana/Anchor detection logic from `src/detect/stack.ts`, Anchor-related bash permissions from agent prompts, Solana test fixtures and test cases, and all Solana references from documentation.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to update agent prompts and remove the stale `stack-solana` skill.

## 0.1.2

### Fixed

- **Use literal-colon filenames `commands/village:NAME.md`**. 0.1.1 used a subdirectory (`commands/village/NAME.md`) which OpenCode resolved as a path (`/village/NAME`) rather than a namespace (`/village:NAME`). Commands are now installed as `commands/village:work.md`, `commands/village:board.md`, `commands/village:envoy.md`, and `commands/village:orphans.md`.

### Upgrade note

Re-run `npx @technoch1ef/opencode-village@latest init --all --force` to replace the stale subdirectory layout from 0.1.1. Alternatively, delete `commands/village/` and re-run `init --all`.

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
- **Stack auto-detection**: automatically detects TypeScript and Ruby on Rails from filesystem signals
- **Bead body linter**: rejects incomplete beads at creation time (`village_lint`, scaffold pre-validation)
- **CLI installer**: `npx @technoch1ef/opencode-village init --all` copies agents, commands, and skills into OpenCode config
- **Tools**: `village_claim`, `village_handoff`, `village_scaffold`, `village_lint`, `village_board`, `village_detect_stack`, `village_ensure_branch`, `village_orphans`, `village_status`, `village_worktrees`
- **Commands**: `/village:work`, `/village:orphans`
- **Skills**: `beads-workflow`, `stack-typescript`, `stack-ruby-on-rails` (each with review checklists)
- **Monorepo support**: stack detection walks to repo root and scans `packages/*`
- **Worktree support**: parallel village sessions via git worktrees with conflict detection
