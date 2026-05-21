import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// -------------------------------------------------------------------------
// TPS tracking state
// -------------------------------------------------------------------------

let messageStart: number | null = null;
let streamStart: number | null = null;
let estimatedStreamedTokens = 0;
let totalOutputTokens = 0;
let totalStreamMs = 0;

function resetTpsTracking(): void {
	messageStart = null;
	streamStart = null;
	estimatedStreamedTokens = 0;
	totalOutputTokens = 0;
	totalStreamMs = 0;
}

// -------------------------------------------------------------------------
// Token formatting
// -------------------------------------------------------------------------

function fmtTok(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

// -------------------------------------------------------------------------
// Stats aggregation
// -------------------------------------------------------------------------

interface TokenStats {
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
}

function collectTokenStats(ctx: ExtensionContext): TokenStats {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cost = 0;

	for (const e of ctx.sessionManager.getEntries()) {
		if (e.type === "message" && e.message.role === "assistant") {
			const m = e.message as AssistantMessage;
			input += m.usage.input;
			output += m.usage.output;
			cacheRead += m.usage.cacheRead || 0;
			cost += m.usage.cost.total;
		}
	}

	return { input, output, cacheRead, cost };
}

// -------------------------------------------------------------------------
// Footer segments
// -------------------------------------------------------------------------

function buildLeftSegment(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	footerData: any,
): string {
	const parts: string[] = [];

	const branch = footerData.getGitBranch();
	if (branch) parts.push(`󰘬 ${branch}`);

	const modelId = ctx.model?.id || "no-model";
	parts.push(` ${modelId}`);

	const provider = (ctx.model as any)?.provider;
	if (provider) parts.push(` ${provider}`);

	const thinkingLevel = pi.getThinkingLevel();
	if (thinkingLevel && thinkingLevel !== "off") {
		parts.push(` ${thinkingLevel}`);
	}

	return parts.join("  ");
}

function buildRightSegment(stats: TokenStats): string {
	const parts: string[] = [];

	if (stats.input > 0) parts.push(` ${fmtTok(stats.input)}`);
	if (stats.output > 0) parts.push(` ${fmtTok(stats.output)}`);
	if (stats.cacheRead > 0) parts.push(` ${fmtTok(stats.cacheRead)}`);
	if (stats.cost > 0) parts.push(` ${stats.cost.toFixed(3)}`);

	return parts.join("  ");
}

// -------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------

function layoutLine(
	left: string,
	right: string,
	width: number,
	theme: any,
	margin = 2,
): string {
	const contentWidth = Math.max(0, width - margin * 2);
	const minPad = 2;

	const leftW = visibleWidth(left);
	const rightW = visibleWidth(right);

	let line: string;
	if (leftW + minPad + rightW <= contentWidth) {
		const pad = " ".repeat(contentWidth - leftW - rightW);
		line = left + pad + theme.fg("dim", right);
	} else if (rightW + minPad < contentWidth) {
		const maxLeft = contentWidth - rightW - minPad;
		const leftTrunc = truncateToWidth(left, maxLeft, "");
		const pad = " ".repeat(contentWidth - visibleWidth(leftTrunc) - rightW);
		line = leftTrunc + pad + theme.fg("dim", right);
	} else {
		line = truncateToWidth(left, contentWidth, "");
	}

	const finalLine = " ".repeat(margin) + line + " ".repeat(margin);
	return truncateToWidth(finalLine, width);
}

// -------------------------------------------------------------------------
// Footer renderer factory
// -------------------------------------------------------------------------

function createFooterRenderer(ctx: ExtensionContext, pi: ExtensionAPI) {
	return (tui: any, theme: any, footerData: any) => {
		const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

		// Widget above editor: compact info (branch, model, tokens)
		ctx.ui.setWidget("compact-info", () => ({
			render(w: number): string[] {
				const stats = collectTokenStats(ctx);
				const left = buildLeftSegment(ctx, pi, footerData);
				const right = buildRightSegment(stats);
				return [layoutLine(left, right, w, theme, 1)];
			},
			invalidate() { },
		}));

		return {
			dispose: () => {
				unsubBranch();
				ctx.ui.setWidget("compact-info", undefined);
			},
			invalidate() { },
			render(width: number): string[] {
				const statuses: Map<string, string> = footerData.getExtensionStatuses();
				if (statuses.size === 0) return [];

				const tpsText = statuses.get("tps");
				const otherTexts = Array.from(statuses.entries())
					.filter(([key]) => key !== "tps")
					.sort((a, b) => a[0].localeCompare(b[0]))
					.map(([, text]) => text);

				const left = theme.fg("dim", otherTexts.join(" "));
				if (tpsText) {
					const margin = 1;
					const contentW = width - margin;
					const leftW = visibleWidth(left);
					const rightW = visibleWidth(tpsText);
					if (leftW + rightW + 2 <= contentW) {
						const pad = " ".repeat(contentW - leftW - rightW);
						return [truncateToWidth(" " + left + pad + tpsText, width)];
					}
					return [truncateToWidth(" " + left + " " + tpsText, width)];
				}
				return [truncateToWidth(" " + left, width)];
			},
		};
	};
}

// -------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------

export default function customFooterExtension(pi: ExtensionAPI): void {
	let enabled = true;

	function attachFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter(createFooterRenderer(ctx, pi));
	}

	pi.registerCommand("footer", {
		description: "Toggle custom compact footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				attachFooter(ctx);
				ctx.ui.notify("Custom footer enabled", "success");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (enabled) attachFooter(ctx);
	});

	// ── TPS tracking ──────────────────────────────────────────────────────────────

	pi.on("agent_start", async (_event, ctx) => {
		resetTpsTracking();
		ctx.ui.setStatus("tps", ctx.ui.theme.fg("dim", "⏱ generating..."));
	});

	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") return;
		messageStart = Date.now();
		streamStart = null;
		estimatedStreamedTokens = 0;
	});

	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant") return;

		const se = event.assistantMessageEvent;
		const isDelta = se.type === "text_delta" || se.type === "thinking_delta" || se.type === "toolcall_delta";
		if (!isDelta) return;

		const now = Date.now();
		streamStart ??= now;
		estimatedStreamedTokens += Math.max(0, se.delta.length / 4);

		const elapsed = (now - streamStart) / 1000;
		const official = event.message.usage.output;
		const tokens = official > 0 ? official : estimatedStreamedTokens;

		if (elapsed > 0 && tokens > 0) {
			const tps = Math.round(tokens / elapsed);
			const tokenLabel = official > 0 ? `${official} tok` : `~${Math.round(estimatedStreamedTokens)} tok`;
			const theme = ctx.ui.theme;
			ctx.ui.setStatus("tps",
				`${theme.fg("accent", `${tps} tok/s`)} ${theme.fg("dim", `(${tokenLabel} / ${elapsed.toFixed(1)}s)`)}`);
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		const tokens = event.message.usage.output;
		const timingStart = streamStart ?? messageStart;
		if (!timingStart || tokens <= 0) {
			messageStart = null;
			streamStart = null;
			estimatedStreamedTokens = 0;
			return;
		}
		totalOutputTokens += tokens;
		totalStreamMs += Math.max(0, Date.now() - timingStart);
		messageStart = null;
		streamStart = null;
		estimatedStreamedTokens = 0;
	});

	pi.on("agent_end", async (_event, ctx) => {
		const elapsed = totalStreamMs / 1000;
		const tps = totalOutputTokens > 0 && elapsed > 0 ? Math.round(totalOutputTokens / elapsed) : 0;
		const theme = ctx.ui.theme;
		const tpsLabel = tps > 0 ? theme.fg("accent", `${tps} tok/s`) : theme.fg("dim", "N/A");
		const detail = theme.fg("dim", `${totalOutputTokens} tokens in ${elapsed.toFixed(1)}s streaming`);
		ctx.ui.notify(`${theme.fg("success", "✓")} ${tpsLabel}  ${detail}`, "info");
		ctx.ui.setStatus("tps", theme.fg("dim", `done — ${tpsLabel}`));
	});
}
