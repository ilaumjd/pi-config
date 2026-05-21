/**
 * Simplify — Review changed files for clarity, consistency, and maintainability.
 *
 * /simplify [--staged] [--ref=<ref>] [files...]
 *
 * Runs git diff to find changed files, then injects a structured review prompt.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface ChangedFile {
  path: string;
  status: "modified" | "added" | "renamed" | "copied";
}

const STATUS_MAP: Record<string, ChangedFile["status"]> = {
  M: "modified",
  A: "added",
  R: "renamed",
  C: "copied",
};

function parseDiffOutput(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const statusCode = parts[0]?.[0];
    if (!statusCode) continue;
    const status = STATUS_MAP[statusCode];
    if (!status) continue;
    const path = (status === "renamed" || status === "copied") ? parts[2] : parts[1];
    if (path) files.push({ path, status });
  }
  return files;
}

async function getChangedFiles(pi: ExtensionAPI, cwd: string, files: string[], staged: boolean, ref: string): Promise<ChangedFile[]> {
  if (files.length > 0) {
    return files.map(path => ({ path, status: "modified" as const }));
  }

  const args = ["diff", "--name-status"];
  if (staged) args.push("--cached");
  else args.push(ref);

  const result = await pi.exec("git", args, { cwd });
  if (result.code === 0) {
    const changed = parseDiffOutput(result.stdout);
    if (changed.length > 0) return changed;
  }

  // Fallback: diff against previous commit
  const fallback = await pi.exec("git", ["diff", "--name-status", "HEAD~1"], { cwd });
  if (fallback.code === 0) return parseDiffOutput(fallback.stdout);

  return [];
}

function buildPrompt(files: ChangedFile[]): string {
  const fileList = files.map(f => `- ${f.path} (${f.status})`).join("\n");

  return `Review the following recently changed files and apply simplification improvements.

## Principles

- **Preserve functionality**: Never change what the code does. All existing tests must continue to pass.
- **Apply project standards**: Follow any conventions from CLAUDE.md or AGENTS.md in this project.
- **Enhance clarity**: Reduce unnecessary complexity and nesting, eliminate redundant code and abstractions, improve variable and function names, consolidate related logic, remove unnecessary comments that describe obvious code. Avoid nested ternary operators: prefer switch statements or if/else chains for multiple conditions.
- **Maintain balance**: Do not over-simplify. Avoid overly clever solutions that are hard to understand. Do not combine too many concerns into single functions. Do not remove helpful abstractions. Prioritize readability over fewer lines.

## Scope

Only review and modify these files:
${fileList}

## Process

1. Read each file listed above
2. Identify concrete improvements (dead code, unclear names, redundant logic, inconsistent patterns)
3. Apply changes one file at a time
4. After all changes, run existing tests to verify nothing is broken
5. Summarize what you changed and why

Do NOT add new features, change public APIs, or refactor code outside the listed files.`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("simplify", {
    description: "Review recently changed files for clarity, consistency, and maintainability improvements",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const explicitFiles: string[] = [];
      let ref = "HEAD";
      let staged = false;

      for (const token of tokens) {
        if (token === "--staged") {
          staged = true;
        } else if (token.startsWith("--ref=")) {
          ref = token.slice("--ref=".length);
        } else {
          explicitFiles.push(token);
        }
      }

      const changed = await getChangedFiles(pi, ctx.cwd, explicitFiles, staged, ref);

      if (changed.length === 0) {
        ctx.ui.notify("No changed files found. Specify file paths or make some changes first.", "info");
        return;
      }

      const prompt = buildPrompt(changed);
      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    },
  });
}
