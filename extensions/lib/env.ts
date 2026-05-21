import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read an env var from process.env first, then fall back to ~/.pi/agent/.env.
 * Supports KEY=value, export KEY=value, and quoted values.
 */
export function readEnv(name: string): string | undefined {
	if (process.env[name]) return process.env[name];

	const envPath = join(homedir(), ".pi", "agent", ".env");
	let envText = "";

	try {
		envText = readFileSync(envPath, "utf8");
	} catch {
		return undefined;
	}

	for (const line of envText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match || match[1] !== name) continue;

		const value = match[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			return value.slice(1, -1);
		}

		return value.replace(/\s+#.*$/, "");
	}

	return undefined;
}
