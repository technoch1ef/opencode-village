/**
 * Session helpers.
 *
 * Provides a factory that closes over the OpenCode plugin `session` domain to
 * expose session lookup and actor resolution.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { AGENT_TO_ACTOR } from "./br";

/** The public interface returned by `createSessionHelpers`. */
export interface SessionHelpers {
  getSession(id: string): Promise<any>;
  resolveActor(sessionID: string): Promise<string | undefined>;
}

/**
 * Create session helpers bound to the given OpenCode plugin session domain.
 */
export function createSessionHelpers(
  session: Plugin.Context["session"],
): SessionHelpers {
  async function getSession(id: string) {
    return (await session.get({ sessionID: id })) as any;
  }

  async function resolveActor(
    sessionID: string,
  ): Promise<string | undefined> {
    const s = await getSession(sessionID);
    const sessionAgent = s?.agent as string | undefined;
    return sessionAgent && AGENT_TO_ACTOR[sessionAgent]
      ? AGENT_TO_ACTOR[sessionAgent]
      : undefined;
  }

  return { getSession, resolveActor };
}
