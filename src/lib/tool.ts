/**
 * Minimal tool-definition helper.
 *
 * Keeps the v1 `tool({ description, args, execute })` shape for the village
 * tools; `src/plugin.ts` adapts each definition to the OpenCode v2 tool API.
 */

import { z } from "zod";

/** Context passed to village tool `execute` functions. */
export interface ToolContext {
  sessionID: string;
  agent: string;
  /** Directory of the calling session. */
  directory: string;
}

export interface ToolDefinition<A extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: A;
  execute(args: z.infer<z.ZodObject<A>>, context: ToolContext): Promise<string>;
}

export function tool<A extends z.ZodRawShape>(def: ToolDefinition<A>): ToolDefinition<A> {
  return def;
}

tool.schema = z;
