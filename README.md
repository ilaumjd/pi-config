# pi-config

Personal [pi](https://github.com/earendil-works/pi-coding-agent) agent configuration.

## What this repo is

A dotfiles-style config repo for the **pi** coding agent. Lives at `~/.pi/agent/` (this directory). All config edits here take effect after `/reload` in pi.

## Setup

```bash
git clone <remote-url> ~/.pi/agent
```

After editing any config file → run `/reload` in pi.

## Structure

```
├── AGENTS.md              — Agent instructions (loaded by pi as project context)
├── README.md              — This file
├── keybindings.json       — Custom keyboard shortcuts
├── extensions/            — Custom TypeScript extensions (auto-discovered by pi)
├── themes/                — UI themes
├── prompts/               — Prompt templates (reserved)
├── skills/                — Skills (reserved; skills managed via available_skills)
├── plan/                  — Planning documents (gitignored)
└── trash/                 — Scratch directory
```

## Keybindings

Defined in [`keybindings.json`](./keybindings.json):

| Key | Action |
|---|---|
| `ctrl+enter` | Follow-up / send message |
| `left` | Cursor left in editor |
| `right` | Cursor right in editor |
| `shift+enter`, `alt+enter` | New line in input |

## Configuration

See [`settings.json`](./settings.json) (gitignored) for:

- **Provider & models** — `defaultProvider: opencode-go`, 6 enabled models
- **Theme** — `astrodark`
- **Packages** — npm packages + git packages loaded at runtime
- **Subagent model overrides** — scout, researcher, planner, worker, reviewer, context-builder, oracle, delegate
- **Memory** — consolidation model, selective lesson injection
- **Default thinking level** — `high`
