/**
 * Retry — Continue after system interruption.
 *
 * /retry aborts the current turn (if running), injects an interruption
 * note into the next system prompt, and triggers a new turn with "Continue."
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let shouldInjectRetryNote = false;
  let retryInProgress = false;

  pi.registerCommand("retry", {
    description: "Continue after interruption",
    handler: async (_args, ctx) => {
      if (retryInProgress) {
        ctx.ui.notify("Retry is already in progress", "warning");
        return;
      }
      if (!ctx.isIdle()) ctx.abort();

      retryInProgress = true;
      shouldInjectRetryNote = true;
      pi.sendMessage(
        { customType: "retry-trigger", content: "Continue.", display: false },
        { triggerTurn: true },
      );
    },
  });

  pi.on("before_agent_start", (event) => {
    if (!shouldInjectRetryNote) return;
    shouldInjectRetryNote = false;
    return { systemPrompt: event.systemPrompt + "\n\nThe previous turn was interrupted by the system." };
  });

  pi.on("agent_start", () => {
    retryInProgress = false;
  });
}
