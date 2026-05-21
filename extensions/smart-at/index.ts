/**
 * Smart @ — Fast project-aware file search autocomplete.
 *
 * Design:
 *   1. Cache bound to user interaction: collect on first @ trigger, clear on selection/dismissal
 *   2. Pre-computed path penalties (path-intrinsic, query-independent)
 *   3. Tiered penalty consumption: each file hits only the highest tier, no stacking
 *   4. Search computes match score only; total = matchScore + pre-computed penalty
 *
 * Collection:
 *   - Git repos: git ls-files for files, derive directories from paths
 *   - Non-git repos: fd for files and directories
 *
 * Penalty tiers (first hit consumed, no stacking):
 *   Tier 1 (-400): matches .gitignore rules (git repos only)
 *   Tier 2 (-300): inside .* or __* directories
 *   Tier 3 (-200): inside known noise dirs (build/dist/coverage etc.)
 *   Tier 4 (-150~-80): bad extensions (binaries/build artifacts/media)
 *   Base (always): -depth*20 - name.length
 *
 * Matching: case-sensitive, directories preferred.
 *
 * IMPORTANT: applyCompletion / shouldTriggerFileCompletion MUST use .bind(orig).
 * Pi's editor does prototype checks — arrow functions will crash the extension.
 */

import { spawnSync } from "child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type PenaltyTier = 0 | 1 | 2 | 3 | 4;

interface FileCandidate {
  path: string;
  name: string;
  isDir: boolean;
  tier: PenaltyTier;
  penalty: number;
}

// ═══════════════════════════════════════════════════════════
// Hard excludes & penalty rules
// ═══════════════════════════════════════════════════════════

const HARD_EXCLUDE_DIRS = new Set(["node_modules", ".git", ".pnpm", ".svn"]);

const BAD_DIRS = new Set(["build", "dist", "coverage", "out", "target"]);

const EXT_PENALTY: Record<string, number> = {
  o: -150, obj: -150, a: -150, so: -150, dll: -150, exe: -150,
  wasm: -150, class: -120, pyc: -120,
  bmp: -100, png: -100, jpg: -100, gif: -100, ico: -100, svg: -80,
  mp3: -100, wav: -100, mp4: -100, avi: -100,
  pdf: -100, zip: -100, tar: -100, gz: -100,
  lock: -80,
};

// ═══════════════════════════════════════════════════════════
// Penalty computation (tiered, first hit consumed)
// ═══════════════════════════════════════════════════════════

interface PenaltyMeta {
  tier: PenaltyTier;
  penalty: number;
}

function computePenaltyMeta(filePath: string, isDir: boolean, gitIgnored: boolean): PenaltyMeta {
  const parts = filePath.replace(/\/$/, "").split("/");
  const name = parts[parts.length - 1] || filePath;
  const ext = (!isDir && name.includes(".")) ? (name.split(".").pop()?.toLowerCase() || "") : "";
  const depth = parts.length;

  const dirSegments = isDir ? parts : parts.slice(0, -1);

  let tier: PenaltyTier = 0;
  let tierPenalty = 0;

  if (gitIgnored) {
    tier = 1;
    tierPenalty = -400;
  } else if (dirSegments.some(d => d.startsWith(".") || d.startsWith("__"))) {
    tier = 2;
    tierPenalty = -300;
  } else if (dirSegments.some(d => BAD_DIRS.has(d))) {
    tier = 3;
    tierPenalty = -200;
  } else if (!isDir && (EXT_PENALTY[ext] ?? 0) < 0) {
    tier = 4;
    tierPenalty = EXT_PENALTY[ext]!;
  }

  const basePenalty = -(depth * 20) - name.length;
  return { tier, penalty: tierPenalty + basePenalty };
}

// ═══════════════════════════════════════════════════════════
// Candidate collection
// ═══════════════════════════════════════════════════════════

const SPAWN_OPTS = { timeout: 5000, encoding: "utf-8" as const, maxBuffer: 10 * 1024 * 1024 };

function collectCandidates(cwd: string): FileCandidate[] {
  const candidates: FileCandidate[] = [];

  const isChildOfHardExclude = (p: string): boolean => {
    const parts = p.replace(/\/$/, "").split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      if (HARD_EXCLUDE_DIRS.has(parts[i]!)) return true;
    }
    return false;
  };

  const opts = { ...SPAWN_OPTS, cwd };
  const isGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], opts).status === 0;

  if (isGit) {
    collectGit(candidates, opts, isChildOfHardExclude);
  } else {
    collectFd(candidates, cwd, isChildOfHardExclude);
  }

  return candidates;
}

function collectGit(
  candidates: FileCandidate[],
  opts: { timeout: number; encoding: "utf-8"; maxBuffer: number; cwd: string },
  isChildOfHardExclude: (p: string) => boolean,
) {
  // Visible files (tracked + untracked non-ignored)
  const r1 = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], opts);
  const visibleFiles = (r1.status === 0 && r1.stdout)
    ? r1.stdout.trim().split("\n").filter(Boolean)
    : [];

  // Ignored entries (directory-first aggregation)
  const r2 = spawnSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"],
    opts,
  );
  const ignoredDirs = new Set<string>();
  const ignoredFiles: string[] = [];
  if (r2.status === 0 && r2.stdout) {
    for (const raw of r2.stdout.trim().split("\n").filter(Boolean)) {
      const entry = raw.replace(/^\.\//, "");
      if (isChildOfHardExclude(entry)) continue;
      if (entry.endsWith("/")) {
        ignoredDirs.add(entry.replace(/\/$/, ""));
      } else {
        ignoredFiles.push(entry);
      }
    }
  }

  const ignoredFileSet = new Set(ignoredFiles);

  // Visible files → candidates
  const dirSet = new Set<string>();
  for (const f of visibleFiles) {
    if (isChildOfHardExclude(f)) continue;
    const name = f.split("/").pop() || f;
    const meta = computePenaltyMeta(f, false, false);
    candidates.push({ path: f, name, isDir: false, tier: meta.tier, penalty: meta.penalty });
    // Derive directories
    const parts = f.split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i]!;
      dirSet.add(current);
    }
  }

  // Ignored files → candidates
  for (const f of ignoredFiles) {
    const name = f.split("/").pop() || f;
    const meta = computePenaltyMeta(f, false, true);
    candidates.push({ path: f, name, isDir: false, tier: meta.tier, penalty: meta.penalty });
  }

  // Derived visible directories → candidates
  for (const d of dirSet) {
    const name = d.split("/").pop() || d;
    const meta = computePenaltyMeta(d, true, false);
    candidates.push({ path: d + "/", name, isDir: true, tier: meta.tier, penalty: meta.penalty });
  }

  // Ignored directories → candidates
  for (const d of ignoredDirs) {
    const name = d.split("/").pop() || d;
    const meta = computePenaltyMeta(d, true, true);
    candidates.push({ path: d + "/", name, isDir: true, tier: meta.tier, penalty: meta.penalty });
  }

  // Hard-exclude dirs themselves → candidates (only if they exist)
  for (const hd of HARD_EXCLUDE_DIRS) {
    if (!existsSync(join(opts.cwd, hd))) continue;
    const meta = computePenaltyMeta(hd, true, false);
    candidates.push({ path: hd + "/", name: hd, isDir: true, tier: meta.tier, penalty: meta.penalty });
  }
}

function collectFd(
  candidates: FileCandidate[],
  cwd: string,
  isChildOfHardExclude: (p: string) => boolean,
) {
  const rel = (s: string) => {
    let r = s.startsWith(cwd + "/") ? s.slice(cwd.length + 1) : s;
    return r.startsWith("./") ? r.slice(2) : r;
  };

  const fdExcludes = [...HARD_EXCLUDE_DIRS].flatMap(d => ["--exclude", d]);
  const fdOpts = { ...SPAWN_OPTS, cwd: undefined as string | undefined };

  // Files
  const r1 = spawnSync("fd", ["--type", "f", "--hidden", "--no-ignore", ...fdExcludes, ".", cwd], fdOpts);
  if (r1.status === 0 && r1.stdout) {
    for (const raw of r1.stdout.trim().split("\n").filter(Boolean)) {
      const f = rel(raw);
      const name = f.split("/").pop() || f;
      const meta = computePenaltyMeta(f, false, false);
      candidates.push({ path: f, name, isDir: false, tier: meta.tier, penalty: meta.penalty });
    }
  }

  // Directories
  const r2 = spawnSync("fd", ["--type", "d", "--hidden", "--no-ignore", ...fdExcludes, ".", cwd], fdOpts);
  if (r2.status === 0 && r2.stdout) {
    for (const raw of r2.stdout.trim().split("\n").filter(Boolean)) {
      const d = rel(raw).replace(/\/$/, "");
      const name = d.split("/").pop() || d;
      const meta = computePenaltyMeta(d, true, false);
      candidates.push({ path: d + "/", name, isDir: true, tier: meta.tier, penalty: meta.penalty });
    }
  }

  // Hard-exclude dirs themselves
  for (const hd of HARD_EXCLUDE_DIRS) {
    if (!existsSync(join(cwd, hd))) continue;
    const meta = computePenaltyMeta(hd, true, false);
    candidates.push({ path: hd + "/", name: hd, isDir: true, tier: meta.tier, penalty: meta.penalty });
  }
}

// ═══════════════════════════════════════════════════════════
// Match scoring (query-dependent, case-sensitive)
// ═══════════════════════════════════════════════════════════

function fuzzyScore(text: string, query: string): number {
  let qi = 0, firstMatch = -1, lastMatch = -1;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      if (firstMatch < 0) firstMatch = ti;
      lastMatch = ti;
      qi++;
    }
  }
  if (qi < query.length) return 0;
  const span = lastMatch - firstMatch + 1;
  return Math.max(10, 200 - span * 3 - text.length);
}

function computeMatchScore(candidate: FileCandidate, query: string): number {
  const { path: filePath, name, isDir } = candidate;
  const stem = name.replace(/\.[^.]+$/, "");
  const parts = filePath.replace(/\/$/, "").split("/");
  const inDir = parts.slice(0, -1).some(d => d.includes(query));

  let s = 0;

  if (stem === query)                                                       s = isDir ? 1500 : 1200;
  else if (name.startsWith(query + ".") || name.startsWith(query + "_"))    s = 1000;
  else if (name.startsWith(query))                                          s = 900;
  else if (name.includes(query))                                            s = 600;
  else if (filePath.includes(query))                                        s = 300;
  else                                                                      s = fuzzyScore(name, query);

  if (!s) return 0;

  if (isDir) s += 50;
  if (inDir) s += 250;

  return s;
}

// ═══════════════════════════════════════════════════════════
// Search (matchScore + penalty = total, sorted)
// ═══════════════════════════════════════════════════════════

function smartSearch(candidates: FileCandidate[], query: string): string[] {
  if (!query) {
    const visible = candidates.filter(c => c.tier === 0 || c.tier === 3 || c.tier === 4);
    return visible
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return b.penalty - a.penalty || a.path.localeCompare(b.path);
      })
      .slice(0, 20)
      .map(c => c.path);
  }

  const tokens = query.split(/\s+/).filter(Boolean);

  if (tokens.length === 1) {
    const scored = candidates
      .map(c => {
        const matchScore = computeMatchScore(c, tokens[0]!);
        return { path: c.path, total: matchScore + c.penalty, matchScore };
      })
      .filter(x => x.matchScore > 0);

    return scored
      .sort((a, b) => b.total - a.total || a.path.localeCompare(b.path))
      .slice(0, 20)
      .map(x => x.path);
  }

  // Multi-word: each token independently, union results
  const seen = new Set<string>();
  for (const t of tokens) {
    const scored = candidates
      .map(c => {
        const matchScore = computeMatchScore(c, t);
        return { path: c.path, total: matchScore + c.penalty, matchScore };
      })
      .filter(x => x.matchScore > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
    for (const { path } of scored) seen.add(path);
  }
  return [...seen].slice(0, 20);
}

// ═══════════════════════════════════════════════════════════
// @ prefix detection
// ═══════════════════════════════════════════════════════════

function atPrefix(text: string): string | null {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== "@") continue;
    const b = text[i - 1];
    if (i === 0 || b === " " || b === "\t" || b === "(" || b === "[") return text.slice(i);
    return null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Entry
// ═══════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_e: any, ctx: any) => {
    const cwd = String(ctx.cwd || "").trim();

    let cache: FileCandidate[] | null = null;

    function getOrBuildCache(): FileCandidate[] {
      if (!cache) cache = collectCandidates(cwd);
      return cache;
    }

    function clearCache() {
      cache = null;
    }

    ctx.ui.addAutocompleteProvider((orig: any) => ({
      getSuggestions: (lines: any, cl: any, cc: any, opts: any) => {
        const prefix = atPrefix((lines[cl] || "").slice(0, cc));
        if (!prefix) {
          clearCache();
          ctx.ui.setWidget("smart-at", undefined);
          return orig.getSuggestions(lines, cl, cc, opts);
        }

        const candidates = getOrBuildCache();
        const results = smartSearch(candidates, prefix.slice(1));

        if (!results.length) {
          ctx.ui.setWidget("smart-at", undefined);
          return null;
        }

        ctx.ui.setWidget("smart-at", ["\x1b[2mpowered by smart-at\x1b[0m"]);
        return Promise.resolve({
          items: results.map((f: string) => ({
            value: "@" + f,
            label: f.replace(/\/$/, "").split("/").pop() || f,
            description: f,
          })),
          prefix,
        });
      },
      applyCompletion: (...args: any[]) => {
        clearCache();
        ctx.ui.setWidget("smart-at", undefined);
        return orig.applyCompletion.apply(orig, args);
      },
      shouldTriggerFileCompletion: orig.shouldTriggerFileCompletion?.bind(orig),
    }));
  });
}
