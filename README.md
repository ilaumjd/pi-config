# pi-config

Personal [pi](https://github.com/earendil-works/pi-coding-agent) agent configuration.

## What this repo is

A dotfiles-style config repo for the **pi** coding agent. Lives at `~/.pi/agent/`.

## Setup

```bash
git clone <remote-url> ~/.pi/agent
```

After editing any config file → run `/reload` in pi.

## Structure

- `keybindings.json` — keyboard shortcuts
- `extensions/` — custom extensions (auto-discovered)
- `themes/` — UI themes
- `prompts/`, `skills/` — prompt templates and skills
- `AGENTS.md` — agent instructions loaded by pi

## Gitignored

- `settings.json` — provider/model/user prefs
- `auth.json`, `.env` — API keys
- `models.json`, `mcp-cache.json` — generated
- `npm/`, `sessions/`, `.pi-lens/` — runtime data
- `extensions/app_data/` — extension runtime data
