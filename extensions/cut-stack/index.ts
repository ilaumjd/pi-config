import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

function showEmptyStackToast(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify("Cut stack is empty", "info");
}

function handleCut(ctx: ExtensionContext, stack: string[]): void {
	if (!ctx.hasUI) return;
	const text = ctx.ui.getEditorText();
	if (!text) return;
	stack.push(text);
	ctx.ui.setEditorText("");
}

function handlePop(ctx: ExtensionContext, stack: string[]): void {
	if (!ctx.hasUI) return;
	const text = stack.pop();
	if (!text) {
		showEmptyStackToast(ctx);
		return;
	}
	const current = ctx.ui.getEditorText();
	ctx.ui.setEditorText(current + text);
}

export default function piCutStack(pi: ExtensionAPI): void {
	const stack: string[] = [];

	pi.registerShortcut("alt+x" as KeyId, {
		description: "Cut editor content to stack",
		handler: (ctx) => handleCut(ctx, stack),
	});

	pi.registerShortcut("alt+p" as KeyId, {
		description: "Pop cut stack into editor",
		handler: (ctx) => handlePop(ctx, stack),
	});
}
