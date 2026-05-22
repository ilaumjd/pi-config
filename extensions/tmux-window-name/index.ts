/**
 * tmux-window-name — Rename the tmux window to show pi is active.
 *
 * When pi starts: disables tmux automatic-rename, sets window name to
 * "pi: <project>" so you can see pi is running from any tmux window.
 * During processing: animates a braille spinner in the window name.
 * On shutdown: re-enables automatic-rename so directory naming resumes.
 *
 * Always targets pi's own window by ID — does not affect other windows
 * even when you switch to them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

export default function (pi: ExtensionAPI) {
  if (!process.env.TMUX) return; // not in tmux, nothing to do

  const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let projectLabel = "pi";
  let windowId: string | null = null;
  let spinnerIdx = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  /** Run a tmux command, silently ignoring failures. */
  function tmux(args: string[]): void {
    try {
      const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
      execSync(`tmux ${escaped}`, { timeout: 1000, stdio: "ignore" });
    } catch {
      // tmux unavailable or command failed — not critical
    }
  }

  /** Rename pi's window (by ID if known, else current window). */
  function renameWindow(name: string): void {
    if (windowId) {
      tmux(["rename-window", "-t", windowId, name]);
    } else {
      tmux(["rename-window", name]);
    }
  }

  function startSpinner(): void {
    spinnerIdx = 0;
    renameWindow(`${projectLabel} ${SPINNER[0]}`);
    spinnerTimer = setInterval(() => {
      spinnerIdx = (spinnerIdx + 1) % SPINNER.length;
      renameWindow(`${projectLabel} ${SPINNER[spinnerIdx]}`);
    }, 200);
  }

  function stopSpinner(): void {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    renameWindow(projectLabel);
  }

  pi.on("session_start", (_event, ctx) => {
    const cwd = ctx.cwd || process.cwd();
    const base = cwd.split("/").filter(Boolean).pop() || "pi";
    projectLabel = `pi: ${base}`;

    // Try to capture pi's window ID for targeted renaming
    try {
      const result = execSync("tmux display-message -p '#{window_id}'", {
        timeout: 1000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (result) windowId = result;
    } catch {
      // Fall back to untargeted rename — will rename whatever
      // window is current, but still functional
    }

    if (windowId) {
      tmux(["set-window-option", "-t", windowId, "-q", "automatic-rename", "off"]);
    } else {
      tmux(["set-window-option", "-q", "automatic-rename", "off"]);
    }
    renameWindow(projectLabel);
  });

  pi.on("agent_start", () => {
    startSpinner();
  });

  pi.on("agent_end", () => {
    stopSpinner();
  });

  pi.on("session_shutdown", () => {
    stopSpinner();
    renameWindow(projectLabel);
    if (windowId) {
      tmux(["set-window-option", "-t", windowId, "-q", "automatic-rename", "on"]);
    } else {
      tmux(["set-window-option", "-q", "automatic-rename", "on"]);
    }
  });

  // Fallback cleanup on process exit (covers crashes, SIGINT, etc.)
  process.on("exit", () => {
    if (spinnerTimer) clearInterval(spinnerTimer);
    if (windowId) {
      tmux(["set-window-option", "-t", windowId, "-q", "automatic-rename", "on"]);
    } else {
      tmux(["set-window-option", "-q", "automatic-rename", "on"]);
    }
  });
}
