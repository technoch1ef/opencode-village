/**
 * `village_board` tool — read-only at-a-glance view of village state.
 *
 * Renders a fixed-width ASCII table with roles as columns and
 * statuses (ready / in_progress / blocked / recently closed) as rows.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { execBrJson } from "../lib/br";
import type { SessionHelpers } from "../lib/sessions";
import type { BrIssue } from "../lib/shared";

/** All village roles — used as board columns. */
const BOARD_ROLES = ["mayor", "worker", "inspector", "guard", "envoy"] as const;

/** Row categories for the board. */
const BOARD_ROWS = ["ready", "in_progress", "blocked", "recently closed"] as const;

/**
 * Compute a human-readable age string from an ISO timestamp.
 *
 * Examples: `2m`, `45m`, `3h`, `1d`, `3d`.
 */
export function formatAge(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return "";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Format a single bead entry for a board cell.
 *
 * In-progress beads include age: `bd-14 (2h)`.
 */
export function formatBoardEntry(bead: BrIssue, showAge: boolean): string {
  const id = bead.id;
  if (showAge) {
    const age = formatAge(bead.updated_at ?? bead.created_at);
    return age ? `${id} (${age})` : id;
  }
  return id;
}

/**
 * Group beads by assignee (role).
 *
 * Returns a map: `role → BrIssue[]`.
 */
function groupByRole(beads: BrIssue[]): Map<string, BrIssue[]> {
  const map = new Map<string, BrIssue[]>();
  for (const bead of beads) {
    const role = (bead.assignee ?? "").trim().toLowerCase() || "(unassigned)";
    const list = map.get(role) ?? [];
    list.push(bead);
    map.set(role, list);
  }
  return map;
}

/**
 * Build the board data structure — a 2D map of `[row][role] → string[]`.
 */
export type BoardData = Record<string, Record<string, string[]>>;

export async function buildBoardData(options: {
  cwd?: string;
  actor?: string;
  epic?: string;
}): Promise<{ data: BoardData; epicTitle?: string }> {
  const { cwd, actor, epic } = options;
  const brOpts = { cwd, actor };

  // Fetch beads in all relevant statuses.
  const [openBeads, inProgressBeads, closedBeads] = await Promise.all([
    fetchBeads(["list", "--status", "open", "--json"], brOpts),
    fetchBeads(["list", "--status", "in_progress", "--json"], brOpts),
    fetchBeads(["list", "--status", "closed", "--json"], brOpts),
  ]);

  let epicTitle: string | undefined;

  // If epic is provided, scope to its children.
  let childIds: Set<string> | null = null;
  if (epic) {
    try {
      const children = await execBrJson<BrIssue[]>(
        ["children", epic, "--json"],
        brOpts,
      );
      if (Array.isArray(children)) {
        childIds = new Set(children.map((c) => c.id));
      }
    } catch {
      // If children command fails, try listing all and filtering by parent.
      childIds = null;
    }

    // Try to get epic title.
    try {
      const epicData = await execBrJson<BrIssue[]>(
        ["show", epic, "--json"],
        brOpts,
      );
      const first = Array.isArray(epicData) ? epicData[0] : undefined;
      epicTitle = first?.title;
    } catch {
      // Best-effort.
    }
  }

  const filterByEpic = (beads: BrIssue[]): BrIssue[] => {
    if (!childIds) return beads;
    return beads.filter((b) => childIds!.has(b.id));
  };

  // Separate "ready" beads: open beads that could be claimed (assignee set, not blocked).
  // For simplicity, treat all open beads as "ready" since `br ready` already filters.
  // We'll try `br ready` per role if no epic filter; otherwise fall back to open list.
  let readyBeads: BrIssue[];
  if (epic) {
    readyBeads = filterByEpic(openBeads);
  } else {
    // Use open beads (which includes ready beads).
    readyBeads = openBeads;
  }

  // Filter blocked beads (status=blocked or status=open with "blocked" somewhere).
  const blockedBeads = filterByEpic(
    [...openBeads, ...inProgressBeads].filter(
      (b) => (b.status ?? "").toLowerCase() === "blocked",
    ),
  );

  // Filter out blocked from ready.
  const blockedIds = new Set(blockedBeads.map((b) => b.id));
  readyBeads = readyBeads.filter((b) => !blockedIds.has(b.id));

  const activeInProgress = filterByEpic(inProgressBeads);

  // Recently closed: last 5, sorted by updated_at desc.
  let recentlyClosed = filterByEpic(closedBeads)
    .sort((a, b) => {
      const aDate = Date.parse(a.updated_at ?? a.created_at ?? "");
      const bDate = Date.parse(b.updated_at ?? b.created_at ?? "");
      return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0);
    })
    .slice(0, 5);

  // Build the board data.
  const data: BoardData = {};
  for (const row of BOARD_ROWS) {
    data[row] = {};
    for (const role of BOARD_ROLES) {
      data[row][role] = [];
    }
  }

  // Populate ready row.
  const readyByRole = groupByRole(readyBeads);
  for (const role of BOARD_ROLES) {
    data["ready"][role] = (readyByRole.get(role) ?? []).map((b) =>
      formatBoardEntry(b, false),
    );
  }

  // Populate in_progress row.
  const ipByRole = groupByRole(activeInProgress);
  for (const role of BOARD_ROLES) {
    data["in_progress"][role] = (ipByRole.get(role) ?? []).map((b) =>
      formatBoardEntry(b, true),
    );
  }

  // Populate blocked row.
  const blockedByRole = groupByRole(blockedBeads);
  for (const role of BOARD_ROLES) {
    data["blocked"][role] = (blockedByRole.get(role) ?? []).map((b) =>
      formatBoardEntry(b, false),
    );
  }

  // Populate recently closed row (collapsed — just IDs, no role split).
  const closedIds = recentlyClosed.map((b) => b.id);
  // Put all recently closed in the first column as a merged row.
  data["recently closed"]["_merged"] = closedIds;

  return { data, epicTitle };
}

/**
 * Fetch beads with a br command, returning [] on failure.
 */
async function fetchBeads(
  args: string[],
  options: { cwd?: string; actor?: string },
): Promise<BrIssue[]> {
  try {
    const result = await execBrJson<BrIssue[]>(args, options);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Render the board data as a fixed-width ASCII table.
 */
export function renderBoard(
  data: BoardData,
  options?: { epicTitle?: string; epic?: string },
): string {
  const roles = [...BOARD_ROLES];

  // Compute column widths — minimum width is the role name length + 2.
  const colWidths: Record<string, number> = {};
  for (const role of roles) {
    colWidths[role] = Math.max(role.length + 2, 3);
  }

  // Find the widest entry per column across all rows.
  for (const row of BOARD_ROWS) {
    if (row === "recently closed") continue; // merged row
    for (const role of roles) {
      const entries = data[row]?.[role] ?? [];
      for (const entry of entries) {
        colWidths[role] = Math.max(colWidths[role], entry.length + 2);
      }
    }
  }

  // Label column width.
  const labelWidth = Math.max("recently closed".length + 2, 18);

  const lines: string[] = [];

  // Header.
  const titleSuffix = options?.epicTitle
    ? ` (${options.epicTitle})`
    : options?.epic
      ? ` (${options.epic})`
      : "";
  lines.push(`=== Village Board${titleSuffix} ===`);
  lines.push("");

  // Column headers.
  const headerCells = roles.map((r) => padRight(r.toUpperCase(), colWidths[r]));
  lines.push(padRight("", labelWidth) + headerCells.join(""));

  // Status rows (except recently closed).
  for (const row of BOARD_ROWS) {
    if (row === "recently closed") continue;
    const maxEntries = Math.max(
      1,
      ...roles.map((r) => (data[row]?.[r] ?? []).length),
    );

    for (let i = 0; i < maxEntries; i++) {
      const label = i === 0 ? padRight(row, labelWidth) : padRight("", labelWidth);
      const cells = roles.map((r) => {
        const entries = data[row]?.[r] ?? [];
        const value = entries[i] ?? (i === 0 ? "—" : "");
        return padRight(value, colWidths[r]);
      });
      lines.push(label + cells.join(""));
    }
  }

  // Recently closed row (merged across columns).
  const closedIds = data["recently closed"]?.["_merged"] ?? [];
  const closedText = closedIds.length > 0 ? closedIds.join(", ") : "—";
  lines.push(padRight("recently closed", labelWidth) + closedText);

  return lines.join("\n");
}

/**
 * Right-pad a string to the given width.
 */
function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + " ".repeat(width - str.length);
}

/**
 * Create the `village_board` tool definition, bound to session helpers.
 */
export function createBoardTool(helpers: SessionHelpers) {
  return tool({
    description:
      "Read-only at-a-glance view of village state. " +
      "Renders an ASCII table with roles as columns and statuses (ready/in_progress/blocked/recently closed) as rows.",
    args: {
      epic: tool.schema.string().optional(),
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;
      const actor = await helpers.resolveActor(context.sessionID);

      const { data, epicTitle } = await buildBoardData({
        cwd: directory,
        actor,
        epic: args.epic,
      });

      return renderBoard(data, { epicTitle, epic: args.epic });
    },
  });
}
