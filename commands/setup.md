---
description: Install the statusline into your Claude Code settings
---

Run the bundled installer (it is on your PATH because this plugin is enabled) and report its full output to the user:

```bash
statusline-setup
```

If it exits with an error saying `jq` is missing, tell the user to install `jq` (for example `sudo pacman -S jq`, `brew install jq`, or `apt install jq`) and run `/statusline:setup` again.

On success, let the user know the status line — email · mode · model · effort · context-window gauge · 5h/7d rate-limit gauges — will appear on the next status refresh.
