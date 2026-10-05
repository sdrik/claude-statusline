# 1. Installation is owned by the SessionStart hook

Status: superseded by [0002](0002-the-status-line-is-a-mod.md) (statusline 3.0.0). Accepted 2026-09-11, statusline 2.0.0.

## Context

Until 1.x, `/statusline:setup` copied the renderer to a fixed path,
`~/.claude/statusline-command.sh`. A plugin update therefore had no effect until
the user re-ran the command, and nothing signalled the drift — the installed
copy on the author's machine was still the 1.0.0 renderer while the repository
was at 1.1.0.

One fact forces the shape of the fix: the only per-plugin destination that
survives an update, `${CLAUDE_PLUGIN_DATA}`, is exported **only** to hook
processes. It is absent from the Bash tool's environment, so no command a user
can invoke can resolve it. Whatever installs the renderer has to be a hook.

## Decision

A `SessionStart` hook (`hooks/sync.sh`) owns the installation: it copies the
renderer into `${CLAUDE_PLUGIN_DATA}`, writes a version witness beside it, wires
`settings.json` to it behind a guard command, and publishes a fixed-path pointer
for the Bash-side diagnostic to read. `/statusline:status` reports; it cannot
install.

Writing to `settings.json` requires proof of ownership, never presumption: the
entry names the current destination, or carries the sentinel of a guard we
wrote, or names the pre-2.0.0 path *and* the file there hashes to a renderer
this plugin shipped. Anything else is left alone.

The consequence is stated plainly in the README: the plugin writes to `$HOME`
and to the user's settings on every session start, unprompted, with full user
privileges.

## Facts about plugin identity, established empirically

These were measured with throwaway probe plugins against Claude Code 2.1.267 and
2.1.268, not read from documentation. They are recorded because three of them
contradict what the design was written against.

- **`hooks/hooks.json` is auto-loaded.** Declaring it in `plugin.json` under the
  `hooks` key is a load *error* — `Duplicate hooks file detected: … The standard
  hooks/hooks.json is loaded automatically, so manifest.hooks should only
  reference additional hook files` — and puts the plugin in `✘ failed to load`.
  The hook still fires, so nothing surfaces the breakage. The key was removed.
- **Only one copy of a plugin name loads at a time.** The same plugin installed
  from two marketplaces produces two install records, both reported `enabled`,
  but a single winner for hooks, commands and data directory. The winner is the
  **first `<name>@<marketplace>` key in `enabledPlugins`** — proven by flipping
  that order in both directions; install order matters only because installing
  appends the key. `installed_plugins.json` order is irrelevant, and it is not
  alphabetical.
- **The winner flips, and the loser survives.** `plugin disable` on the winner
  promotes the other copy. The demoted install's data directory stays on disk,
  because its plugin is still installed.
- **A path-added marketplace runs the source tree, not its cache.**
  `CLAUDE_PLUGIN_ROOT` points at the original directory; edits there take effect
  at the next session start with no `marketplace update` and no reinstall. A
  cache copy exists in parallel and `plugin list --json` reports `installPath`
  on it, which is a lie about what executes. Only the *version metadata* is
  snapshotted at install time.
- **Ordinary environment variables reach hooks** from the parent shell, from the
  user `env` block, and from a project `env` block. The user-level one is
  visible to sessions started in any directory; the project-level one is not.
- Uninstalling deletes the data directory unless `--keep-data` is passed.

## Consequences

**No collision handling is needed, and none was written.** The reported defect —
one plugin installed from two marketplaces, both hooks rewriting `statusLine`,
one flip per session start — cannot happen: only one hook ever runs. What does
happen is a *winner flip*, which leaves a `statusLine` entry carrying our
sentinel but naming another live destination. The `owned="moved"` branch handles
exactly that, and it must not be narrowed to "adopt only when the named
destination is gone": the demoted install's destination is still there.

**The working tree is privileged when installed as its own marketplace.** That
route is the only way to exercise the hook end to end before a release, and it
runs the working tree live. The hand brake is an existence-only, gitignored
`.statusline-dev-hold` at the root of the checkout; the hook exits immediately
when it is present. Its polarity is inverted on purpose — with nothing in place
the hook behaves exactly as it does for a real user, so an acceptance run tests
what ships. It covers one state and one only: an acceptance install left in
place while editing continues. Day-to-day development goes through
`--plugin-dir`, which the `-inline` guard already stops.

**Disabling the plugin is not an opt-out.** It silences the hook while leaving
the renderer, the data directory and the `statusLine` entry in place, so the
status line keeps rendering, frozen, indefinitely. Nothing of ours can clean up,
because a disabled plugin's hook does not run — and a disabled plugin also takes
`/statusline:status` with it, so the diagnostic cannot report the state either.
This is documented rather than fixed, including the ordering trap: remove the
`statusLine` entry first, disable or uninstall second.

## Alternatives rejected

- **Recording an owning plugin id in the fixed-path pointer**, with non-owners
  standing down. Solves a problem that does not exist, and would have to invent
  a transfer protocol for ownership.
- **Proving ownership by the existence of the destination named in the entry.**
  Wrong: a demoted install's destination still exists, so this would strand the
  new winner.
- **A liveness badge in the renderer**, keyed on the witness file's mtime, to
  reveal a disabled plugin. Punishes a deliberate act with a permanent warning,
  and puts clock reasoning in a renderer that reads only its own two files.
- **A guard keyed on `CLAUDE_PLUGIN_ROOT`'s location** (refuse to run outside
  `~/.claude/plugins/cache`). Would make the acceptance route inert, and rests
  on where a git-sourced marketplace puts its root, which was never measured.
- **An environment variable as the hand brake.** A boolean in the user `env`
  block silences whichever copy is loaded, including the one the user depends
  on; a path-valued variable scopes correctly but separates the signal from the
  thing it describes, and a typo in the path yields a silently inert guard.
