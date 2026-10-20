---
description: Run worker/guard/inspector until all ready village work is done
agent: mayor
---

# /village:work

Run the village until the work is done.

## Template

Follow the **Running the village** loop from your mayor instructions: launch worker, guard and inspector as foreground subagents, one bead at a time, until no worker/guard/inspector bead is ready or in_progress in scope.

Scope: all ready work, unless the request below names an epic — then pass that epic id to **village_board** and tell each subagent to call **village_claim** with `epic: "<id>"`.

Request: $ARGUMENTS

All village operations go through plugin tools (`village_board`, `village_handoff`, `village_scaffold`, etc.). Invoke them via the tool-calling interface, not as shell commands. Never call **village_claim** yourself and never launch envoy.
