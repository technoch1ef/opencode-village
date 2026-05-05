# @technoch1ef/opencode-village

Role-driven "Agentic Village" workflow for [OpenCode](https://opencode.ai) — agents claim, implement, review, and verify work through a structured handoff chain backed by [Beads](https://github.com/Dicklesworthstone/beads_rust) for AI-native issue tracking.

## Requirements

- [`beads_rust`](https://github.com/Dicklesworthstone/beads_rust) installed (the plugin uses it as its backing store)
- [`@technoch1ef/opencode-beads-rust`](https://www.npmjs.com/package/@technoch1ef/opencode-beads-rust) plugin installed in OpenCode
- Node >= 20

## Install

```bash
npm i -D @technoch1ef/opencode-village @technoch1ef/opencode-beads-rust
npx @technoch1ef/opencode-village init --all
# Restart OpenCode
```

## Roles

| Role | Responsibility |
|------|---------------|
| **mayor** | Research, plan, create epics and child beads with `village_scaffold` |
| **worker** | Implement bead tasks, make local commits, hand off to guard |
| **guard** | Run tests/linters/build, hand off to inspector on green or return to worker |
| **inspector** | Read-only judgment: AC coverage, scope check, regression sniff; close beads on approval |
| **envoy** | Push, create PRs, handle releases (optional terminal step) |

**Handoff chain:** mayor → worker → guard → inspector → envoy (optional)

## Commands

| Command | Description |
|---------|-------------|
| `/village:work` | Trigger the work loop for the current agent's role |
| `/village:board` | Show a read-only at-a-glance view of village state |
| `/village:envoy` | Dispatch envoy to push a branch and open a PR for a bead or epic |
| `/village:orphans` | Report and fix unassigned beads |

## Tools

The plugin exposes all village operations as `village_*` tools. Agents and skills should always invoke these tools directly rather than shelling out to underlying CLIs.

| Tool | Description |
|------|-------------|
| `village_claim` | Deterministically claim the next ready bead (single in_progress guard) |
| `village_handoff` | Atomically hand off a bead to another role with a standardized comment |
| `village_scaffold` | Create an epic + child beads with skill validation |
| `village_lint` | Validate an existing bead body for required sections and content |
| `village_board` | Read-only ASCII board showing village state (roles × statuses) |
| `village_ensure_branch` | Create or checkout an `epic/*` branch, fast-forward from base |
| `village_invoke` | Dispatch a bead to a specialist (e.g. envoy) for processing |
| `village_orphans` | Report and fix orphan/suspect-assignee beads (always auto-assigns) |
| `village_status` | List village sessions under the current root session |
| `village_worktrees` | List the current worktree-to-bead mapping for all in-progress beads |

## Skills

| Skill | Purpose |
|-------|---------|
| `village-workflow` | Roles, status flow, handoff conventions; loaded on every implementation bead |

## Customization

### Private skills

Store per-project skills in `~/.config/opencode/skills-private/<name>/SKILL.md`. These are gitignored and loaded alongside public skills.

### Agent overrides

Agents are installed to `~/.config/opencode/agents/`. Edit any agent's markdown file to customize tools, permissions, or workflow instructions. Re-running `init` will prompt before overwriting.

## Upgrade

```bash
npm i -D @technoch1ef/opencode-village@latest
npx @technoch1ef/opencode-village init --all --force
# Restart OpenCode
```

The `--force` flag overwrites existing agent prompts, commands, and skills with the latest versions. Your private skills in `skills-private/` are never touched.

## Smoke test

1. Install and initialize:
   ```bash
   npm i -D @technoch1ef/opencode-village @technoch1ef/opencode-beads-rust
   npx @technoch1ef/opencode-village init --all
   ```
2. Start OpenCode and verify the mayor agent loads as the default agent.
3. Open a worker session and run `/village:work` to confirm the work loop starts.
4. Run `/village:board` to verify the village state renders.

## License

MIT — see [LICENSE](./LICENSE)
