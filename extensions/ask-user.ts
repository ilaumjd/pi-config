/**
 * ask_user — Lean interactive decision gate for pi.
 *
 * Single-file extension. Registers the `ask_user` tool for inline
 * decision selection (single-select from options + freeform).
 *
 * Import resolution: @earendil-works/* and typebox are resolved by pi's
 * runtime (jiti), not from local node_modules.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	SelectList,
	type Component,
	type SelectItem,
	type SelectListTheme,
	type Theme,
	type TUI,
	type KeybindingsManager,
} from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AskOption = { title: string; description?: string };
type AskResponse =
	| { kind: "selection"; selections: string[] }
	| { kind: "freeform"; text: string };

const FREEFORM_SENTINEL = "__ask_freeform__";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptions(raw: unknown[]): AskOption[] {
	return raw
		.map((o) => {
			if (typeof o === "string") return { title: o };
			if (o && typeof o === "object" && "title" in o && typeof (o as any).title === "string")
				return { title: (o as any).title, description: (o as any).description };
			return null;
		})
		.filter((o): o is AskOption => o !== null);
}

function toSelectItems(options: AskOption[], allowFreeform: boolean): SelectItem[] {
	const items: SelectItem[] = options.map((o, i) => ({
		value: String(i),
		label: o.title,
		description: o.description,
	}));
	if (allowFreeform) {
		items.push({ value: FREEFORM_SENTINEL, label: "✏️ Type custom response…", description: "Enter a free-form answer" });
	}
	return items;
}

function createSelectTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}

function formatResponse(r: AskResponse): string {
	return r.kind === "freeform" ? r.text : r.selections.join(", ");
}

// ---------------------------------------------------------------------------
// Inline component
// ---------------------------------------------------------------------------

class AskInline implements Component {
	private selectList: SelectList;
	private question: string;
	private context?: string;
	private theme: Theme;
	private done: (result: AskResponse | null) => void;

	constructor(
		question: string,
		context: string | undefined,
		items: SelectItem[],
		theme: Theme,
		done: (result: AskResponse | null) => void,
	) {
		this.question = question;
		this.context = context;
		this.theme = theme;
		this.done = done;

		this.selectList = new SelectList(items, Math.min(items.length, 12), createSelectTheme(theme));
		this.selectList.onSelect = (item) => this.handleSelect(item);
		this.selectList.onCancel = () => done(null);
	}

	private handleSelect(item: SelectItem): void {
		if (item.value === FREEFORM_SENTINEL) {
			this.done({ kind: "freeform", text: "" });
			return;
		}
		this.done({ kind: "selection", selections: [item.label] });
	}

	invalidate(): void {
		this.selectList.invalidate();
	}

	render(width: number): string[] {
		const lines: string[] = [];

		lines.push(this.theme.fg("accent", `?  ${this.question}`));
		lines.push("");

		if (this.context) {
			for (const line of this.context.split("\n")) {
				lines.push(this.theme.fg("muted", line));
			}
			lines.push("");
		}

		lines.push(...this.selectList.render(width));
		return lines;
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}
}

// ---------------------------------------------------------------------------
// Tool execute handler
// ---------------------------------------------------------------------------

async function handleAsk(
	params: Record<string, unknown>,
	ctx: ExtensionContext,
): Promise<{ content: { type: string; text: string }[]; details?: unknown }> {
	const {
		question,
		context,
		options: rawOptions = [],
		allowFreeform = true,
		timeout,
	} = params as {
		question: string;
		context?: string;
		options?: unknown[];
		allowFreeform?: boolean;
		timeout?: number;
	};

	const options = normalizeOptions(rawOptions as unknown[]);
	const normalizedContext = context?.trim() || undefined;

	// --- No UI available (print / RPC mode) ---
	if (!ctx.hasUI || !ctx.ui) {
		const optText = options.length > 0
			? `\n\nOptions:\n${options.map((o, i) => `  ${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ""}`).join("\n")}`
			: "";
		const freeformHint = allowFreeform ? "\n\nYou can also answer freely." : "";
		const contextText = normalizedContext ? `\n\nContext:\n${normalizedContext}` : "";
		return {
			content: [{ type: "text", text: `Please answer:\n\n${question}${contextText}${optText}${freeformHint}` }],
			isError: true,
			details: { question, context: normalizedContext, options, response: null, cancelled: true },
		} as any;
	}

	// --- No options → use simple input ---
	if (options.length === 0) {
		const prompt = normalizedContext ? `${question}\n\n${normalizedContext}` : question;
		const answer = await ctx.ui.input(prompt, "Type your answer…", timeout ? { timeout } : undefined);
		if (!answer?.trim()) {
			return {
				content: [{ type: "text", text: "User cancelled" }],
				details: { question, context: normalizedContext, options: [], response: null, cancelled: true },
			};
		}
		return {
			content: [{ type: "text", text: `User answered: ${answer.trim()}` }],
			details: { question, context: normalizedContext, options: [], response: { kind: "freeform", text: answer.trim() }, cancelled: false },
		};
	}

	// --- Options → show inline SelectList ---
	const items = toSelectItems(options, allowFreeform);

	let result: AskResponse | null = null;

	try {
		result = await ctx.ui.custom<AskResponse | null>(
			(_tui: TUI, theme: Theme, _keybindings: KeybindingsManager, done: (r: AskResponse | null) => void) => {
				return new AskInline(question, normalizedContext, items, theme, done);
			},
		);
	} catch (error: any) {
		return {
			content: [{ type: "text", text: `ask_user failed: ${error?.message ?? error}` }],
			isError: true,
			details: { question, context: normalizedContext, options, response: null, cancelled: true, error: String(error) },
		};
	}

	// --- Handle freeform selection from the inline list ---
	if (result?.kind === "freeform" && result.text === "") {
		const prompt = normalizedContext ? `${question}\n\n${normalizedContext}` : question;
		const answer = await ctx.ui.input(prompt, "Type your answer…", timeout ? { timeout } : undefined);
		if (!answer?.trim()) {
			return {
				content: [{ type: "text", text: "User cancelled" }],
				details: { question, context: normalizedContext, options, response: null, cancelled: true },
			};
		}
		result = { kind: "freeform", text: answer.trim() };
	}

	if (!result) {
		return {
			content: [{ type: "text", text: "User cancelled" }],
			details: { question, context: normalizedContext, options, response: null, cancelled: true },
		};
	}

	return {
		content: [{ type: "text", text: `User answered: ${formatResponse(result)}` }],
		details: { question, context: normalizedContext, options, response: result, cancelled: false },
	};
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
	// Register the ask-user skill on reload/startup
	pi.on("resources_discover", () => {
		const dir = dirname(fileURLToPath(import.meta.url));
		return {
			skillPaths: [resolve(dir, "ask-user.skill")],
		};
	});

	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user a question with optional multiple-choice answers. Use this to gather information interactively. Ask exactly one focused question per call. Before calling, gather context with tools (read/web/ref) and pass a short summary via the context field.",
		promptSnippet: "Ask the user one focused question with optional multiple-choice answers to gather information interactively",
		promptGuidelines: [
			"Before calling ask_user, gather context with tools (read/web/ref) and pass a short summary via the context field.",
			"Use ask_user when the user's intent is ambiguous, when a decision requires explicit user input, or when multiple valid options exist.",
			"Ask exactly one focused question per ask_user call.",
			"Do not combine multiple numbered, multipart, or unrelated questions into one ask_user prompt.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			context: Type.Optional(
				Type.String({ description: "Relevant context to show before the question (summary of findings)" }),
			),
			options: Type.Optional(
				Type.Array(
					Type.Union([
						Type.String({ description: "Short title for this option" }),
						Type.Object({
							title: Type.String({ description: "Short title for this option" }),
							description: Type.Optional(
								Type.String({ description: "Longer description explaining this option" }),
							),
						}),
					]),
					{ description: "List of options for the user to choose from" },
				),
			),
			allowMultiple: Type.Optional(
				Type.Boolean({ description: "Allow selecting multiple options. Default: false" }),
			),
			allowFreeform: Type.Optional(
				Type.Boolean({ description: "Add a freeform text option. Default: true" }),
			),
			timeout: Type.Optional(
				Type.Number({ description: "Auto-dismiss after N milliseconds. Returns null (cancelled) when expired." }),
			),
		}),

		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			return handleAsk(params as Record<string, unknown>, ctx);
		},
	});
}
