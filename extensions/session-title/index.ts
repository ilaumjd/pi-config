/**
 * Session Title — Auto-name sessions from the first user message.
 *
 * Scans session entries on start, extracts the first user message,
 * and sets it as the session name. Respects manually-set names
 * (won't overwrite if already named).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function extractFirstMessage(entries: Array<{ type: string; message?: { role: string; content?: unknown } }>): string | undefined {
  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message || entry.message.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" && part.text.trim()) {
          return part.text.trim();
        }
      }
    }
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.sessionManager.getSessionName()) return; // respect manual renames
    const title = extractFirstMessage(ctx.sessionManager.getBranch());
    if (title) pi.setSessionName(title);
  });
}
