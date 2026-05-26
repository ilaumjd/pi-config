# pi-config — Agent Instructions

Personal [pi](https://github.com/earendil-works/pi-coding-agent) agent configuration.

## What this repo is

A dotfiles-style config repo for the **pi** coding agent. Lives at `~/.pi/agent/` (this directory). All config edits here take effect after `/reload` in pi.

## Setup

```bash
git clone <remote-url> ~/.pi/agent
```

After editing any config file → run `/reload` in pi.

## Tracked vs excluded files

**Tracked** (edit these):

- `AGENTS.md` — agent instructions (this file)
- `README.md` — repo readme
- `keybindings.json` — keyboard shortcuts
- `extensions/` — custom TypeScript extensions (auto-discovered by pi)
- `themes/` — UI themes
- `prompts/` — prompt templates (reserved)
- `skills/` — skills (reserved; actual skills managed via `available_skills` in agent config)

**Excluded** (`.gitignore` — do NOT commit):

- `settings.json` — provider/model/theme/user prefs, subagent model overrides, memory config
- `auth.json`, `.env` — API keys
- `models.json` — model index (manually managed)
- `mcp-cache.json`, `mcp-onboarding.json` — generated
- `npm/` — installed npm packages (runtime)
- `git/` — cloned repos used as packages
- `sessions/`, `run-history.jsonl` — runtime data
- `.pi-lens/` — LSP cache
- `extensions/app_data/` — extension runtime data
- `extensions/*/node_modules/`, `extensions/*/package-lock.json` — local extension deps
- `plan/`, `pi-crash.log`, `.DS_Store` — misc

## Configuration (settings.json)

The gitignored `settings.json` holds:

- **Provider**: `opencode-go` (default), models: deepseek-v4-flash/pro, minimax-m2.7, qwen3.5-plus/qwen3.6-plus
- **Theme**: `astrodark`, editor padding: 1, quiet startup: true
- **Packages**: npm + git packages loaded at runtime
- **Subagent overrides**: model assignments for scout, researcher, planner, worker, reviewer, context-builder, oracle, delegate
- **Memory**: `lessonInjection: "selective"`, `consolidationModel: opencode-go/deepseek-v4-flash`
- **Default thinking level**: `high`

## Keybindings

| Key | Action |
|---|---|
| `ctrl+enter` | Follow-up / send message |
| `left` | Cursor left in editor |
| `right` | Cursor right in editor |
| `shift+enter`, `alt+enter` | New line in input |

## Gotchas

- `settings.json` is gitignored — changes here are local only
- Subagent model assignments and memory consolidation config live in gitignored `settings.json`
- The `git/` directory contains cloned repos used as packages — not committed
- After editing any tracked config file → run `/reload` in pi to apply changes
- Directory-based extensions with their own `package.json` install deps in their own `node_modules/`
