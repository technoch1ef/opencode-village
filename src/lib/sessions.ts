/**
 * Session-tree and village-session helpers.
 *
 * Provides a factory that closes over the OpenCode `client` to expose
 * session resolution, toast, and village-session listing utilities.
 */

import type { PluginInput } from "@opencode-ai/plugin";
import { AGENT_TO_ACTOR } from "./br";

export type SessionSummary = {
  id: string;
  title: string;
};

/** Check if a session title matches a village role naming convention. */
export function isVillageSessionTitle(title: unknown): title is string {
  return (
    typeof title === "string" &&
    (title.startsWith("village-worker-") ||
      title.startsWith("village-inspector") ||
      title.startsWith("village-guard"))
  );
}

/** The public interface returned by `createSessionHelpers`. */
export interface SessionHelpers {
  getSession(id: string): Promise<any>;
  getVillageSessionSummary(sessionID: string): Promise<SessionSummary | null>;
  showVillageToast(args: {
    sessionID: string;
    title: string;
    message: string;
    variant: "info" | "warning" | "success" | "error";
    duration: number;
  }): Promise<void>;
  getRootSessionID(sessionID: string): Promise<string>;
  listVillageSessions(rootID: string): Promise<{
    workers: SessionSummary[];
    inspectors: SessionSummary[];
    guards: SessionSummary[];
  }>;
  formatSessionList(label: string, sessions: SessionSummary[]): string;
  resolveActor(sessionID: string): Promise<string | undefined>;
  /** Dedupe state for village session error toasts. */
  seenErrorKeys: Set<string>;
  /** Track last-known status per village session for transition detection. */
  lastVillageStatus: Map<string, string>;
}

/**
 * Create session helpers bound to the given OpenCode plugin client.
 *
 * @param client - The OpenCode SDK client from plugin input.
 */
export function createSessionHelpers(
  client: PluginInput["client"],
): SessionHelpers {
  const seenErrorKeys = new Set<string>();
  const lastVillageStatus = new Map<string, string>();

  async function getSession(id: string) {
    const res = await client.session.get({ path: { id } });
    return res.data as any;
  }

  async function getVillageSessionSummary(
    sessionID: string,
  ): Promise<SessionSummary | null> {
    try {
      const session = await getSession(sessionID);
      if (!isVillageSessionTitle(session?.title)) return null;
      return { id: sessionID, title: session.title };
    } catch {
      return null;
    }
  }

  async function showVillageToast(args: {
    sessionID: string;
    title: string;
    message: string;
    variant: "info" | "warning" | "success" | "error";
    duration: number;
  }): Promise<void> {
    try {
      const session = await getSession(args.sessionID);
      const directory =
        typeof session?.directory === "string"
          ? session.directory
          : typeof session?.cwd === "string"
            ? session.cwd
            : undefined;
      if (!directory) return;
      await client.tui.showToast({
        query: { directory },
        body: {
          title: args.title,
          message: args.message,
          variant: args.variant,
          duration: args.duration,
        },
      });
    } catch {
      // Non-critical UX signal.
    }
  }

  async function getRootSessionID(sessionID: string): Promise<string> {
    let cur = sessionID;
    for (let i = 0; i < 25; i++) {
      const session = await getSession(cur);
      const parentID = session?.parentID as string | undefined;
      if (!parentID) return cur;
      cur = parentID;
    }
    return cur;
  }

  async function listVillageSessions(rootID: string): Promise<{
    workers: SessionSummary[];
    inspectors: SessionSummary[];
    guards: SessionSummary[];
  }> {
    const childrenRes = await client.session.children({
      path: { id: rootID },
    });
    const children = (childrenRes.data || []) as any[];

    const workers = children
      .filter(
        (s) =>
          typeof s?.title === "string" &&
          s.title.startsWith("village-worker-"),
      )
      .map((s) => ({ id: String(s.id), title: String(s.title) }))
      .filter((s) => s.id);

    const inspectors = children
      .filter(
        (s) =>
          typeof s?.title === "string" &&
          s.title.startsWith("village-inspector"),
      )
      .map((s) => ({ id: String(s.id), title: String(s.title) }))
      .filter((s) => s.id);

    const guards = children
      .filter(
        (s) =>
          typeof s?.title === "string" &&
          s.title.startsWith("village-guard"),
      )
      .map((s) => ({ id: String(s.id), title: String(s.title) }))
      .filter((s) => s.id);

    return { workers, inspectors, guards };
  }

  function formatSessionList(
    label: string,
    sessions: SessionSummary[],
  ): string {
    if (!sessions.length) return `${label}: (none)`;
    return `${label}: ${sessions.map((s) => `${s.title} (${s.id})`).join(", ")}`;
  }

  async function resolveActor(
    sessionID: string,
  ): Promise<string | undefined> {
    const session = await getSession(sessionID);
    const sessionAgent = session?.agent as string | undefined;
    return sessionAgent && AGENT_TO_ACTOR[sessionAgent]
      ? AGENT_TO_ACTOR[sessionAgent]
      : undefined;
  }

  return {
    getSession,
    getVillageSessionSummary,
    showVillageToast,
    getRootSessionID,
    listVillageSessions,
    formatSessionList,
    resolveActor,
    seenErrorKeys,
    lastVillageStatus,
  };
}
