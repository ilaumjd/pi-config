/**
 * yeet — Add, commit, push, and optionally create a PR.
 *
 * Ported from https://github.com/davis7dotsh/my-pi-setup
 *
 * Usage:
 *   /yeet              → add, commit, and push the current repo changes
 *   /yeet skip push    → add + commit only
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const YEET_PROMPT = `Commit and push the current repository changes.

Steps:
1. Inspect all changed files with \`git status\` and \`git diff --stat\`.
2. Analyze the changes and decide whether they belong in one commit or multiple logical commits (group by concern, directory, or type of change).
3. For each logical group:
   a. Stage the relevant files with \`git add <files>\`.
   b. Inspect the staged changes.
   c. Write a concise commit message using conventional commit format (feat, fix, refactor, chore, docs, style, test, perf, ci, build).
   d. Commit.
4. Push all commits to the current branch's remote.
   - First, check if the remote repository belongs to you. Get the remote URL and your git config user info (\`git config user.name\`, \`git config github.user\`). If the remote URL's owner (e.g. the org/user in \`github.com/owner/repo\`) does not match your identity, do NOT push — just report that the remote is not yours and skip pushing.
   - If the current branch does not have an upstream remote branch, create one by pushing with upstream tracking.
   - If this repository has no git remotes configured, do not push.
5. After pushing, output the remote URL for what was pushed if the repository has a remote.
   - If the current branch is \`main\`, output the normal remote repository URL.
   - If the current branch is not \`main\`, output a URL to create a pull request from the pushed branch into \`main\`.
   - Convert SSH git remotes like \`git@github.com:owner/repo.git\` to HTTPS URLs when printing.`;

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("yeet", {
		description: "Add, commit, and push the current repo changes",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const prompt = args?.trim()
				? `${YEET_PROMPT}\n\nAdditional instructions from the user:\n${args.trim()}`
				: YEET_PROMPT;

			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				ctx.ui.notify("Queued /yeet as a follow-up", "info");
			}
		},
	});
}
