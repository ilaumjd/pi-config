/**
 * Patch engine — Exact string replacement for pi.
 *
 * Replaces diff-based format with old_str/new_str matching.
 * No fuzzy matching, no similarity — only exact string matching.
 *
 * Per-file operations:
 *   { path, edits: [{ old_str, new_str, anchor? }] }  — targeted replacements
 *   { path, overwrite: true, new_str }                — atomic full-file overwrite
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface Edit {
  anchor?: string;
  old_str: string;
  new_str: string;
}

export interface FilePatch {
  path: string;
  edits?: Edit[];
  overwrite?: boolean;
  new_str?: string;
}

export interface PatchResult {
  modified: string[];
  created: string[];
  warnings: string[];
  replacements: Map<string, ReplacementInfo[]>;
  originalLines: Map<string, string[]>;
}

export interface ReplacementInfo {
  oldStartLine: number;
  oldEndLine: number;
  newStartLine: number;
  newEndLine: number;
  oldLines: string[];
  newLines: string[];
  anchor?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

export class ParseError extends Error {
  constructor(message: string) { super(message); this.name = "ParseError"; }
}

export class ApplyError extends Error {
  constructor(message: string) { super(message); this.name = "ApplyError"; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════════════════════════════════════

export async function applyPatch(patch: FilePatch, cwd: string): Promise<PatchResult> {
  if (!patch.path?.trim()) throw new ParseError("File path cannot be empty.");

  const result: PatchResult = {
    modified: [],
    created: [],
    warnings: [],
    replacements: new Map(),
    originalLines: new Map(),
  };

  const absPath = resolveAbsPath(cwd, patch.path);

  if (patch.overwrite) {
    applyOverwrite(absPath, patch.path, patch.new_str ?? "", result);
  } else if (patch.edits && patch.edits.length > 0) {
    await applyEdits(absPath, patch.path, patch.edits, result);
  } else {
    throw new ParseError(`File ${patch.path}: must provide either edits[] or overwrite:true with new_str.`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Overwrite (atomic write → mv)
// ═══════════════════════════════════════════════════════════════════════════

function applyOverwrite(absPath: string, displayPath: string, content: string, result: PatchResult): void {
  const oldContent = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : "";

  ensureParentDir(absPath);
  const dir = path.dirname(absPath);
  const tmpName = path.join(dir, `.pi-patch-${randomId()}.tmp`);
  fs.writeFileSync(tmpName, content, "utf8");
  fs.renameSync(tmpName, absPath);

  if (oldContent) {
    result.modified.push(displayPath);
  } else {
    result.created.push(displayPath);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Edits (exact string replacement)
// ═══════════════════════════════════════════════════════════════════════════

async function applyEdits(
  absPath: string,
  displayPath: string,
  edits: Edit[],
  result: PatchResult,
): Promise<void> {
  if (!fs.existsSync(absPath)) throw new ApplyError(`File not found: ${displayPath}`);
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) throw new ApplyError(`Cannot patch directory: ${displayPath}`);

  const rawContent = fs.readFileSync(absPath, "utf8");
  const origLines = rawContent.split("\n");
  if (origLines.length > 1 && origLines[origLines.length - 1] === "") origLines.pop();
  result.originalLines.set(displayPath, origLines);

  const lineEnding = detectLineEnding(rawContent);
  let content = normalizeLineEndings(rawContent);
  const rawLineOffsets = buildLineOffsets(rawContent);

  let cumulativeOffset = 0;
  const replacements: ReplacementInfo[] = [];

  for (const edit of edits) {
    if (!edit.old_str) throw new ApplyError(`old_str must not be empty in ${displayPath}.`);

    const oldNorm = normalizeLineEndings(edit.old_str);
    const newNorm = normalizeLineEndings(edit.new_str);

    let searchFrom = 0;

    if (edit.anchor) {
      const anchorNorm = normalizeLineEndings(edit.anchor);
      const anchorIdx = content.indexOf(anchorNorm);
      if (anchorIdx === -1) {
        throw new ApplyError(`Anchor not found in ${displayPath}: "${truncate(edit.anchor)}".`);
      }
      const secondAnchor = content.indexOf(anchorNorm, anchorIdx + 1);
      if (secondAnchor !== -1) {
        throw new ApplyError(
          `Anchor is not unique in ${displayPath}: "${truncate(edit.anchor)}" found at multiple locations.`
        );
      }
      searchFrom = anchorIdx;
    }

    const matchIdx = content.indexOf(oldNorm, searchFrom);
    if (matchIdx === -1) {
      throw new ApplyError(
        `old_str not found in ${displayPath}` +
        (edit.anchor ? ` after anchor "${truncate(edit.anchor)}"` : "") +
        `: "${truncate(edit.old_str)}". The file may have changed — re-read it and try again.`
      );
    }

    const secondMatch = content.indexOf(oldNorm, matchIdx + 1);
    if (secondMatch !== -1) {
      throw new ApplyError(
        `old_str is not unique in ${displayPath}: "${truncate(edit.old_str)}". ` +
        `Add more context to old_str or use an anchor to narrow the search.`
      );
    }

    const origMatchIdx = matchIdx - cumulativeOffset;
    const oldStartLine = lineAtOffset(rawLineOffsets, origMatchIdx);
    const oldEndLine = lineAtOffset(rawLineOffsets, origMatchIdx + oldNorm.length - 1);

    content = content.substring(0, matchIdx) + newNorm + content.substring(matchIdx + oldNorm.length);
    cumulativeOffset += newNorm.length - oldNorm.length;

    const newStartLine = charOffsetToLine(content, matchIdx);
    const newEndLine = charOffsetToLine(content, matchIdx + newNorm.length - 1);

    replacements.push({
      oldStartLine,
      oldEndLine,
      newStartLine,
      newEndLine,
      oldLines: oldNorm.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === "")),
      newLines: newNorm.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === "")),
      anchor: edit.anchor ? edit.anchor.split("\n")[0] : undefined,
    });
  }

  const finalContent = restoreLineEndings(content, lineEnding);
  if (lineEnding === "\r\n" && rawContent.includes("\r\n")) {
    result.warnings.push(`${displayPath}: CRLF line endings were normalized to LF during editing.`);
  }

  fs.writeFileSync(absPath, finalContent, "utf8");
  result.modified.push(displayPath);
  result.replacements.set(displayPath, replacements);
}

// ═══════════════════════════════════════════════════════════════════════════
// Diff generation
// ═══════════════════════════════════════════════════════════════════════════

export interface PatchPreview {
  diff?: string;
  error?: string;
  preview?: string;
  isOverwrite?: boolean;
}

export async function computePatchPreview(patch: FilePatch, cwd: string): Promise<PatchPreview> {
  try {
    if (!patch.path?.trim()) return { error: "File path cannot be empty." };

    const absPath = resolveAbsPath(cwd, patch.path);

    if (patch.overwrite) {
      return { preview: patch.new_str ?? "", isOverwrite: true };
    } else if (patch.edits && patch.edits.length > 0) {
      if (!fs.existsSync(absPath)) return { error: "File not found" };

      const rawContent = fs.readFileSync(absPath, "utf8");
      const origLines = rawContent.split("\n");
      if (origLines.length > 1 && origLines[origLines.length - 1] === "") origLines.pop();
      let content = normalizeLineEndings(rawContent);
      const rawLineOffsets = buildLineOffsets(rawContent);
      const allReplacements: ReplacementInfo[] = [];
      let cumulativeOffset = 0;

      for (const edit of patch.edits) {
        if (!edit.old_str) continue;
        const oldNorm = normalizeLineEndings(edit.old_str);
        const newNorm = normalizeLineEndings(edit.new_str);

        let searchFrom = 0;
        if (edit.anchor) {
          const anchorNorm = normalizeLineEndings(edit.anchor);
          const idx = content.indexOf(anchorNorm);
          if (idx === -1) return { error: `Anchor not found: "${truncate(edit.anchor)}"` };
          searchFrom = idx;
        }

        const matchIdx = content.indexOf(oldNorm, searchFrom);
        if (matchIdx === -1) return { error: `old_str not found: "${truncate(edit.old_str)}"` };

        const origMatchIdx = matchIdx - cumulativeOffset;
        const oldStartLine = lineAtOffset(rawLineOffsets, origMatchIdx);
        const oldEndLine = lineAtOffset(rawLineOffsets, origMatchIdx + oldNorm.length - 1);
        const oldLines = oldNorm.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
        const newLines = newNorm.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
        content = content.substring(0, matchIdx) + newNorm + content.substring(matchIdx + oldNorm.length);
        const newStartLine = charOffsetToLine(content, matchIdx);
        const newEndLine = charOffsetToLine(content, matchIdx + newNorm.length - 1);
        allReplacements.push({ oldStartLine, oldEndLine, newStartLine, newEndLine, oldLines, newLines, anchor: edit.anchor ? edit.anchor.split("\n")[0] : undefined });
        cumulativeOffset += newNorm.length - oldNorm.length;
      }

      const diff = generateReplacementDiff(patch.path, allReplacements, origLines);
      return { diff };
    } else {
      return { error: "Must provide edits[] or overwrite:true" };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function generatePatchDiff(result: PatchResult): string {
  const parts: string[] = [];
  for (const [filePath, reps] of result.replacements) {
    const origLines = result.originalLines.get(filePath) ?? [];
    parts.push(generateReplacementDiff(filePath, reps, origLines));
  }
  return parts.join("\n");
}

interface ReplacementChunk {
  startLine: number;
  endLine: number;
  reps: ReplacementInfo[];
}

function buildReplacementChunks(reps: ReplacementInfo[], totalLines: number, contextLines: number): ReplacementChunk[] {
  const sorted = [...reps].sort((a, b) => a.oldStartLine - b.oldStartLine);
  const chunks: ReplacementChunk[] = [];

  for (const rep of sorted) {
    const startLine = Math.max(1, rep.oldStartLine - contextLines);
    const endLine = Math.min(totalLines, rep.oldEndLine + contextLines);
    const current = chunks[chunks.length - 1];

    if (current && startLine <= current.endLine + 1) {
      current.endLine = Math.max(current.endLine, endLine);
      current.reps.push(rep);
    } else {
      chunks.push({ startLine, endLine, reps: [rep] });
    }
  }

  return chunks;
}

function getChunkAnchors(chunk: ReplacementChunk): string[] {
  return [...new Set(chunk.reps.map(rep => rep.anchor?.trim()).filter(Boolean) as string[])];
}

function formatChunkHeader(chunk: ReplacementChunk): string {
  const range = chunk.startLine === chunk.endLine
    ? String(chunk.startLine)
    : `${chunk.startLine}-${chunk.endLine}`;
  const anchors = getChunkAnchors(chunk);
  if (anchors.length === 0) return `@@ lines ${range} @@`;
  if (anchors.length === 1) return `@@ lines ${range} @@ anchor: ${anchors[0]}`;
  return `@@ lines ${range} @@`;
}

function formatChunkMetadataLines(chunk: ReplacementChunk): string[] {
  const anchors = getChunkAnchors(chunk);
  if (anchors.length <= 1) return [];
  const shown = anchors.slice(0, 2);
  const remaining = anchors.length - shown.length;
  const lines = ["anchors:", ...shown.map(a => `  - ${a}`)];
  if (remaining > 0) lines.push(`  - +${remaining} more`);
  return lines;
}

function generateReplacementDiff(filePath: string, reps: ReplacementInfo[], originalLines: string[]): string {
  const parts: string[] = [];
  parts.push(`--- ${filePath}`);
  parts.push(`+++ ${filePath}`);

  if (reps.length === 0) {
    parts.push("");
    return parts.join("\n");
  }

  const maxLineNum = Math.max(originalLines.length, ...reps.map(r => r.oldEndLine));
  const numWidth = String(maxLineNum).length;
  const CONTEXT = 3;
  const chunks = buildReplacementChunks(reps, originalLines.length, CONTEXT);

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]!;
    if (c > 0) parts.push("");
    parts.push(formatChunkHeader(chunk));
    parts.push(...formatChunkMetadataLines(chunk));

    let cursor = chunk.startLine;

    for (const rep of chunk.reps) {
      for (let i = cursor; i < rep.oldStartLine; i++) {
        const num = String(i).padStart(numWidth, " ");
        parts.push(` ${num} ${originalLines[i - 1]}`);
      }
      for (let i = 0; i < rep.oldLines.length; i++) {
        const num = String(rep.oldStartLine + i).padStart(numWidth, " ");
        parts.push(`-${num} ${rep.oldLines[i]}`);
      }
      for (let i = 0; i < rep.newLines.length; i++) {
        const num = String(rep.oldStartLine + i).padStart(numWidth, " ");
        parts.push(`+${num} ${rep.newLines[i]}`);
      }
      cursor = rep.oldEndLine + 1;
    }

    for (let i = cursor; i <= chunk.endLine; i++) {
      const num = String(i).padStart(numWidth, " ");
      parts.push(` ${num} ${originalLines[i - 1]}`);
    }
  }

  if (parts[parts.length - 1] !== "") parts.push("");
  return parts.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

export function formatPatchResult(result: PatchResult): string {
  const lines: string[] = [];
  for (const p of result.created) lines.push(`A ${p}`);
  for (const p of result.modified) lines.push(`M ${p}`);
  let output = lines.length > 0
    ? "Updated the following files:\n" + lines.join("\n")
    : "No files were modified.";
  if (result.warnings.length > 0) {
    output += "\n\n" + result.warnings.join("\n");
  }
  return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function resolveAbsPath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function ensureParentDir(absPath: string): void {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function detectLineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(text: string, ending: string): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function buildLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function lineAtOffset(lineOffsets: number[], charOffset: number): number {
  let lo = 0, hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= charOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function charOffsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function truncate(s: string, maxLen = 60): string {
  if (s.length <= maxLen) return s;
  const firstLine = s.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}
