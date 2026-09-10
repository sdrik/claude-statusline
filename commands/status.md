---
description: Report where the statusline is installed and whether it is up to date
---

Run the bundled diagnostic (it is on your PATH because this plugin is enabled) and report its full output to the user:

```bash
statusline-status
```

Keep in mind, and explain if it comes up, that this command only reports — it cannot install. The status line installs itself from a `SessionStart` hook, because the destination path is only resolvable from a hook environment. If it reports that nothing is installed yet, the answer is to start a new session, not to run something.

If it reports the renderer as STALE, the copy failed on the last few session starts; the directory being unwritable is the usual cause.

If it reports `settings.json` wired to something else, that is deliberate: the plugin never overwrites a `statusLine` entry it cannot prove is its own.
