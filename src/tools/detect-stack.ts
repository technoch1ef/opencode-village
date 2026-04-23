/**
 * `village_detect_stack` tool — expose stack detection for planning prompts.
 *
 * Returns the detected skill names for a given directory, allowing the mayor
 * to inspect what stacks are present before scaffolding an epic.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import { detectStack } from "../detect/stack";

/**
 * Create the `village_detect_stack` tool definition.
 */
export function createDetectStackTool() {
  return tool({
    description:
      "Detect the technology stack of a project directory and return matching skill names. " +
      "Useful for planning: the mayor can call this before scaffolding to see which stack " +
      "skills will be auto-injected.",
    args: {
      directory: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const directory = args.directory ?? context.directory;

      const skills = await detectStack(directory);

      const lines: string[] = [];
      lines.push(`Detected skills for: ${directory}`);
      lines.push("");
      for (const skill of skills) {
        lines.push(`- ${skill}`);
      }

      return lines.join("\n");
    },
  });
}
