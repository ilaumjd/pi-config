/**
 * File mtime tracking for stale-read protection.
 *
 * - `read` tool records mtime when the LLM reads a file
 * - `patch` tool checks mtime before editing — rejects if file changed since last read
 * - `patch` tool updates mtime after a successful write
 */

import * as fs from "node:fs";
import * as path from "node:path";

const readMarkers = new Map<string, number>();

function getFileMtime(absPath: string): number {
  return fs.statSync(absPath).mtimeMs;
}

export function recordReadTime(absPath: string): void {
  if (!fs.existsSync(absPath)) return;
  readMarkers.set(absPath, getFileMtime(absPath));
}

export function checkStaleFile(absPath: string, displayPath: string): string | undefined {
  if (!fs.existsSync(absPath)) return undefined;

  const lastRead = readMarkers.get(absPath);
  if (lastRead === undefined) {
    return `File not read yet: ${displayPath}. Please read the file with the read tool before editing.`;
  }

  const currentMtime = getFileMtime(absPath);
  if (currentMtime > lastRead) {
    return `File modified since last read: ${displayPath}. Please re-read the file with the read tool before editing.`;
  }

  return undefined;
}

export function clearReadMarkers(): void {
  readMarkers.clear();
}

export function resolveAbsolutePath(cwd: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return path.normalize(path.resolve(cwd, filePath));
}
