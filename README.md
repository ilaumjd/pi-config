# pi-config

Personal [pi](https://github.com/earendil-works/pi-coding-agent) agent configuration.

## Structure

```
~/.pi/agent/ → ~/pi-config/  (symlinked configs)
├── keybindings.json           # Keyboard shortcuts
├── fzf.json                   # Smart @ completion config
├── decorated-pi.json          # Decorated-pi module toggles
├── mcp-onboarding.json        # MCP server onboarding state
├── extensions/                # Custom extension .ts files
│   ├── custom-footer.ts
│   └── pi-info.ts
├── themes/
│   └── astrodark.json
├── prompts/                   # Prompt templates (stub)
└── skills/                    # Skills (stub)
```

Runtime data (sessions, npm packages, auth, settings) stays local at `~/.pi/agent/`.

## Setup

```bash
git clone <remote-url> ~/pi-config
ln -s ~/pi-config ~/.pi/agent   # if not already set up
```

Edit config files in `~/pi-config/`, then run `/reload` in pi.

## Note

- `settings.json` is excluded from git — contains provider/model config
- Scripts (e.g. `generate-models.js`) live in [dotfiles](https://github.com/iam/dotfiles) repo
