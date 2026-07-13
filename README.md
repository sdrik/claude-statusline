# statusline

A Claude Code plugin that installs a rich status line into your Claude Code
session. Once set up, the bottom status line shows, left to right:

```
email │ mode │ model │ effort │ context-window gauge │ 5h rate-limit gauge │ 7d rate-limit gauge
```

- **email** — the connected account's email (from `~/.claude.json`, falling back to `$CLAUDE_CODE_EMAIL`)
- **mode** — current permission mode (Plan mode / Accept edits / Bypass perms / Default mode)
- **model** — active model display name
- **effort** — reasoning effort level
- **context-window gauge** — a coloured bar with the used percentage, plus `↑input/window ↓output` tokens
- **rate-limit gauges** — 5-hour and 7-day subscription usage bars, each with time until reset

Gauges are green below 50%, yellow from 50–79%, and red at 80% and above.

## Requirements

- `bash`
- `jq` — **required**; the status line silently renders nothing if `jq` is missing
- `awk`, `grep`, `tail`, `date`, `printf` — standard on Linux and macOS/BSD

Works on Linux (GNU) and macOS/BSD.

## Usage

Once the plugin is enabled:

- `/statusline:setup` — installs the status line. It copies the renderer to
  `~/.claude/statusline-command.sh` and adds a `statusLine` entry to
  `~/.claude/settings.json`; all your other settings are preserved. If a
  *different* script already exists at that path, it is backed up once to
  `~/.claude/statusline-command.sh.pre-statusline-plugin.bak`.
- `/statusline:uninstall` — removes the `statusLine` entry from your settings and
  deletes the installed renderer (only when it is unchanged from the shipped one;
  a customised script is left in place).

The status line refreshes after each assistant message, so it appears or
disappears on the next refresh.

## How it works

Claude Code plugins can't set the main status line declaratively (a plugin's own
`settings.json` only honours the `agent` and `subagentStatusLine` keys). So this
plugin ships the renderer script plus a small installer that writes the
`statusLine` entry into your user settings — the same approach the built-in
`/statusline` command uses. The renderer is copied to a stable path so it keeps
working across plugin updates.
