const SHELL_SNIPPET_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

export type BrIssue = {
  id: string;
  title?: string;
  status?: string;
  priority?: number;
  created_at?: string;
  updated_at?: string;
  assignee?: string;
  issue_type?: string;
  description?: string;
  notes?: string;
};

export function compareBrIssuesDeterministic(a: BrIssue, b: BrIssue): number {
  const ap = typeof a.priority === "number" ? a.priority : Number.POSITIVE_INFINITY;
  const bp = typeof b.priority === "number" ? b.priority : Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;

  const atRaw = typeof a.created_at === "string" ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
  const btRaw = typeof b.created_at === "string" ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
  const at = Number.isFinite(atRaw) ? atRaw : Number.POSITIVE_INFINITY;
  const bt = Number.isFinite(btRaw) ? btRaw : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;

  const aid = typeof a.id === "string" ? a.id : "";
  const bid = typeof b.id === "string" ? b.id : "";
  return aid.localeCompare(bid);
}

export type SingleInProgressGuardResult =
  | { kind: "none" }
  | { kind: "existing"; issue: BrIssue }
  | { kind: "multiple"; issues: BrIssue[] };

export function guardSingleInProgress(inProgress: BrIssue[]): SingleInProgressGuardResult {
  if (inProgress.length === 0) return { kind: "none" };
  if (inProgress.length === 1) return { kind: "existing", issue: inProgress[0] };
  return { kind: "multiple", issues: inProgress.slice().sort(compareBrIssuesDeterministic) };
}

export function selectDeterministicReady(ready: BrIssue[]): BrIssue | null {
  if (!ready.length) return null;
  return ready.slice().sort(compareBrIssuesDeterministic)[0] ?? null;
}

/** Valid non-epic assignee roles in the village. */
export type VillageAssignee = "worker" | "inspector" | "guard";

/** All valid non-epic assignee names. */
export const VALID_ASSIGNEES: ReadonlySet<string> = new Set<VillageAssignee>([
  "worker",
  "inspector",
  "guard",
]);

/**
 * Infer the appropriate assignee for an orphaned bead based on its text content.
 *
 * - keywords `review|verify|inspect|scope` → `inspector`
 * - keywords `test|lint|build|check` → `guard`
 * - default → `worker`
 */
export function inferAssigneeFromText(text: string): VillageAssignee {
  const t = text.toLowerCase();
  const inspectorKeywords = [
    "review",
    "verify",
    "inspect",
    "scope",
    "inspector",
    "judgment",
    "approve",
  ];
  const guardKeywords = [
    "test",
    "lint",
    "build",
    "check",
    "guard",
    "typecheck",
    "ci",
  ];
  if (inspectorKeywords.some((k) => t.includes(k))) return "inspector";
  if (guardKeywords.some((k) => t.includes(k))) return "guard";
  return "worker";
}

export function fixShellSnippetNewlines(text: unknown): unknown {
  if (typeof text !== "string") return text;

  // `; \nbr ...` is copy/paste-unsafe in shells (\n becomes `n`, e.g. `\nbr` => `nbr`).
  // This normalizes *shell* code fences only, turning the literal `\n` token into
  // a real newline when it is used as a command separator (e.g. `; \n`, `&& \n`).
  if (!text.includes("\\n")) return text;

  const codeFenceRegex = /```([a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g;

  return text.replace(codeFenceRegex, (full, lang, body) => {
    const tag = (typeof lang === "string" ? lang : "").toLowerCase();
    if (!SHELL_SNIPPET_LANGS.has(tag)) return full;

    const fixedBody = String(body)
      .replace(/([;]|&&|\|\|)[ \t]*\\n[ \t]*/g, "$1\n")
      .replace(/^\\n[ \t]*/g, "\n");

    const opening = lang ? `\`\`\`${lang}\n` : "```\n";
    const bodyWithTrailingNewline = fixedBody.endsWith("\n") ? fixedBody : `${fixedBody}\n`;
    return `${opening}${bodyWithTrailingNewline}` + "```";
  });
}

export const WORKER_WORK_LOOP_PROMPT = `Claim the next bead assigned to worker and start working on it.

Use this workflow:
1. Claim deterministically by calling \`village_claim\` (single in_progress guard):
   - \`existing in_progress: <id> | ...\` => continue that bead
   - \`claimed: <id> | ...\` => start that bead
   - \`no ready beads for worker\` => report that and wait
2. Read the bead details and handoff packet: \`br show <id> --json\`
3. Load skills listed under \`## Skills\`
4. \`village_claim\` has placed you on the bead's branch and refreshed it from the default base; verify with \`git status\`.
   - If \`village_ensure_branch\` returned \`skipped\` due to dirty tree, commit/stash first then re-run \`village_ensure_branch\`.
   - If the branch does not exist and is not an \`epic/*\` branch, mark blocked and report.
5. Implement only what the bead asks for (keep changes minimal)
6. Commit locally (no push): \`git add -A && git commit -m "bead(<id>): <short description>"\`
7. Hand off to inspector:
   - Call \`village_handoff\` with \`{ bead: "<id>", to: "inspector", note: "Implementation complete. Ready for review." }\`
8. Repeat from step 1.`;

export const INSPECTOR_WORK_LOOP_PROMPT = `Claim the next bead assigned to inspector and start reviewing it.

Use this workflow:
1. Claim deterministically by calling \`village_claim\` (single in_progress guard):
   - \`existing in_progress: <id> | ...\` => continue that bead
   - \`claimed: <id> | ...\` => start that bead
   - \`no ready beads for inspector\` => report that and wait
2. Read the bead details: \`br show <id> --json\`
3. Load skills listed under \`## Skills\`
4. Gather the diff: \`git diff $(git merge-base HEAD main)..HEAD\`
5. Run the judgment checklist:
   - AC coverage: parse \`- [ ]\` items, verify each is addressed by the diff
   - Diff scope: flag files changed outside expected scope
   - Regression sniff: deleted tests, \`TODO\`/\`console.log\`, \`any\` casts, hardcoded secrets
   - Stack review: apply each \`stack-*\` skill's \`## Review Checklist\`
6. If judgment passes:
   - Call \`village_handoff\` with \`{ bead: "<id>", to: "guard", note: "<structured summary>" }\`
7. If changes needed:
   - Call \`village_handoff\` with \`{ bead: "<id>", to: "worker", note: "<itemized findings>" }\`
8. Repeat from step 1.`;

export const GUARD_WORK_LOOP_PROMPT = `Claim the next bead assigned to guard and start running checks.

Use this workflow:
1. Claim deterministically by calling \`village_claim\` (single in_progress guard):
   - \`existing in_progress: <id> | ...\` => continue that bead
   - \`claimed: <id> | ...\` => start that bead
   - \`no ready beads for guard\` => report that and wait
2. Read the bead details: \`br show <id> --json\`
3. Load skills listed under \`## Skills\` and run the appropriate checks (tests/linters/build)
4. If all checks pass:
   - \`br comments add <id> "Approved. Checks: <...>"\`
   - \`br close <id> --reason "Approved"\`
   - post-close parent epic check:
     - \`PARENT_ID=$(br show <id> --json | jq -r '.[0].parent // empty')\`
     - \`if [ -n "$PARENT_ID" ]; then br children "$PARENT_ID" --json; fi\`
     - \`if [ -n "$PARENT_ID" ]; then OPEN_CHILD_COUNT=$(br children "$PARENT_ID" --json | jq '[.[] | select(.status != "closed")] | length'); fi\`
     - \`if [ -n "$PARENT_ID" ] && [ "$OPEN_CHILD_COUNT" -eq 0 ]; then br close "$PARENT_ID" --reason "All child beads closed"; fi\`
5. If checks fail:
   - Call \`village_handoff\` with \`{ bead: "<id>", to: "worker", note: "Checks failed: <actionable bullets>" }\`
6. Repeat from step 1.`;
