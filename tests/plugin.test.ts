import { describe, expect, test } from "bun:test";

import { _resetPreflight, startBrPreflight } from "../src/lib/preflight";
import VillagePlugin from "../src/plugin";

describe("VillagePlugin (v2)", () => {
  test("registers village tools with session directory in context", async () => {
    const added: any[] = [];
    let disposed = false;
    const ctx: any = {
      location: { directory: "/fallback" },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({
          id: sessionID,
          agent: "worker",
          location: { directory: "/repo" },
        }),
      },
      tool: {
        transform: async (cb: (editor: any) => void) => {
          cb({ add: (t: any) => added.push(t) });
          return { dispose: async () => { disposed = true; } };
        },
      },
    };

    expect(VillagePlugin.id).toBe("village");
    const cleanup = await VillagePlugin.setup(ctx);

    expect(added.map((t) => t.name).sort()).toEqual([
      "village_board",
      "village_claim",
      "village_ensure_branch",
      "village_handoff",
      "village_invoke",
      "village_lint",
      "village_orphans",
      "village_scaffold",
      "village_worktrees",
    ]);
    for (const t of added) {
      expect(t.options.codemode).toBe(false);
      expect(typeof t.input["~standard"]).toBe("object");
    }

    const lint = added.find((t) => t.name === "village_lint");
    await expect(
      lint.execute({ bead: " " }, { sessionID: "s1", agent: "worker" }),
    ).rejects.toThrow("bead ID is required");

    await (cleanup as () => Promise<void>)();
    expect(disposed).toBe(true);

    // setup() starts the module-level preflight; settle and reset it for other test files.
    await startBrPreflight();
    _resetPreflight();
  });
});
