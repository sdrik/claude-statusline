# 2. The status line is a mod

Status: accepted (2026-10-05, statusline 3.0.0, unreleased). Supersedes
[0001](0001-installation-owned-by-the-session-hook.md).

## Context

Up to 2.0.0 the line is a `statusLine` command. A plugin cannot declare one, so
a SessionStart hook copies the renderer out of the plugin, writes a version
witness, and rewrites the user's `settings.json` behind ownership proofs
(ADR 0001). All of that exists only because the renderer lives outside the
plugin, and it is where every defect of 2.0.0 came from.

Mods (function hooks) went GA in Claude Code 2.1.287. A mod renders from inside
the plugin, so it updates with the plugin and there is nothing to copy, wire or
go stale. The spike on `spike/mod-renderer` drew the line in the `AbovePrompt`
band; that band costs a row and is shared with surveys and with every other mod,
so this design avoids it.

## Decision

The status line is a mod. No `statusLine` entry, no copied renderer, no witness,
no staleness badge, no `/statusline:status`.

**Where each figure goes**, chosen per figure rather than one line for all:

| Figure | Site | Shown |
| --- | --- | --- |
| Engine modes (`focus`, `memory paused`), kept on the left | `SessionMode` | always |
| Email, git branch and dirty mark (both off by default) | `SessionMode` | always |
| Model, effort | `SessionMode` | always |
| Context gauge and `↑input/window`, coloured by threshold | `SessionMode` | always |
| `⟳` main-loop requests this session | `SessionMode`, and live in `Spinner.suffix` | always / during a turn |
| Total cost | `SessionMode` | always |
| 5h and 7d gauges with time to reset | `SessionMode` | always |
| Turn summary `↑+Δ ↓output · ⟳ n · $Δ` | `TurnDuration` (terminal only) | in the transcript |
| Thresholds crossed upward (context WARN/CRIT, 5h/7d ≥ 80 %) | `$.ui.toast`, one per measurement, emoji-prefixed | 8 s |

The permission mode is dropped: the footer already shows it.

**Width.** `SessionMode` shares its row with the hint line, so the line fits in
what the footer leaves *now*: viewport width minus the hint as drawn and the
widest mode label. It first switches to compact forms (5-cell gauges, `O5.5`,
`↑input` without `/window`), then drops, in order: email, git, `⟳`, effort,
cost, 5h/7d time left, 5h/7d gauges, model. The context gauge and `↑input`
never go. A narrow terminal has few rows to spare, so the line reflows rather
than taking a row of its own.

**Data.** `$.session.usage()` and `session.measure` for context, cost and rate
limits; `turn.step` for effort and the request count; `turn.start` and
`turn.complete` for the turn summary. The transcript is no longer read.
Thresholds come from the manifest's `userConfig`, with 2.0.0's names and
defaults; the `STATUSLINE_*` environment variables are gone.

**Migration.** On session start, the mod removes a `statusLine` entry that
2.0.0 or 1.x wrote, under the proofs of ADR 0001 (the guard's sentinel, or the
pre-2.0.0 path with a shipped renderer or nothing behind it). Anything else is
left alone and a toast says what to remove. A `.statusline-dev-hold` at the
plugin root still stops it, since a checkout loaded with `--plugin-dir` or as
its own marketplace would otherwise strip the author's working 2.0.0 entry.

## Facts about the engine, established empirically

Measured on Claude Code 2.1.289 with the probes kept in `spike/mod-renderer`
(`spikes/surface-probe`, `spikes/mod-prototype`). Several contradict or go
beyond the documentation.

- **No `classic.*` event reaches a mod.** Not `SessionStart` after `/clear`,
  not `UserPromptSubmit`, not `PreToolUse`, although the docs and the test kit
  describe them. `/clear` and `/resume` are seen only as `session.end` with
  `reason` `clear` or `resume`.
- **Right after `/clear`, `$.session.usage()` still reports the old window**
  until the next response. The mod zeroes the gauge itself on `session.end`.
- **`SessionMode` sits right-aligned on the hint line's row**; when the two do
  not fit, the engine pushes it onto a row of its own.
- **`PromptHint.hint` excludes the mode label** drawn before it:
  `(shift+tab to cycle) · ← for agents` is 35 columns idle, 20 while typing, 54
  during a turn. No event reports the permission mode or a shift+tab, so the
  label's width is unknowable and the widest (`⏵⏵ bypass permissions on`, 24) is
  reserved whenever the hint offers shift+tab.
- **Hex colours are accepted** by `Text` (`color`, `backgroundColor`).
- **`$.ui.toast` is plain text.** ANSI escapes print raw; emoji render in colour.
  Two toasts in the same tick show only the first; three seconds apart they stack.
- **`$.ui.status` costs a row** and is prefixed `⚠ <plugin>:` in yellow;
  `turn.complete`'s `{ text }` costs a row per turn and is prefixed with every
  mod in the chain. Neither is used.
- **`TurnDuration`'s `requestId` is stable across a resume**, so a summary kept
  in `$.store` under it is drawn again after `claude --resume`.
- **`$.session.repo()` has no branch and no dirty state**; git is asked through
  `$.process.run`.
- **Effort before the first request** is `settings.modelSettings[<model
  id>].effortLevel`, keyed by the exact id (`claude-opus-5` is another model
  than `claude-opus-5-5`), else `settings.effortLevel`.

### On the desktop (Claude Code 2.1.291)

- **`e.surface` says where a tree is drawn**, and only it does: the table
  `$.ui.resolve(e)` hands out carries every element's name, so `'Svg' in els`
  holds on the terminal too.
- **The desktop's footer draws the model and the effort itself**, to the right
  of `SessionMode`, and leaves it about forty characters: the line is drawn in
  `AbovePrompt` there, leaving both out, and `SessionMode` is the engine's.
- **Adjacent `Text`s are drawn apart**, so a gauge made of background-coloured
  runs splits (`3 2%`). The desktop's gauges are one `Svg` each.
- **Where an `Svg` is drawn**: `AbovePrompt` draws one beside `Text`s, and the
  pane one alone in its column; `SessionMode` draws none. The pane's legend
  squares, beside `Text`s with an empty `alt`, kept their place undrawn —
  whether the row or the empty `alt` did it is untested.
- **`Svg` cannot paint theme keys**, and nothing resolves a key to a colour
  (`ThemeKey` names keys, never values): the grid paints /context's keys in the
  colours the desktop's dark theme gave them, sampled from a screenshot. The
  legend's squares are a `■` coloured by key.
- **`Box`es with a background** are drawn a full line tall: as squares they
  read as bars.
- **`Button` is a leaf with a `label`**, and `Box` takes no `onPress`: a drawing
  cannot be made pressable, so `⊞` stays beside the gauge. The desktop's footer
  drew it first, out of order; the band draws it in place.
- **/context's glyphs (`⛀⛁⛶⛝`) draw as pictograms** in the desktop's font.
- **The desktop's built-in MCP servers are named by an id** (`1a59c906-…`, the
  engine's `x-mcp-server-id`), in /mcp as in the breakdown, with no display
  name anywhere: the pane names them by their first tools.
- **A press misses after a quick run of redraws.** A `Button`'s handle lives
  as long as the drawing it is in; after two redraws a few ms apart, the
  desktop keeps showing a tree whose handles the engine has retired, answers
  `ui_press not handled`, asks for a fresh drawing, and the next press lands.
  The pane writes once per press, shows `Calcul…` only past 300 ms, and sends
  its docked width (a redraw) on the terminal alone.
- **A blur is such a redraw**: a pressed `Button` gone from the next tree takes
  the pane's focus with it, and `isFocused` flipping redraws. The pane's view
  toggle is one `Button` under one key in every state, and the band's `⊞`
  opens the pane with `focus` on the desktop: unfocused, its first press missed.
- **`TurnDuration` is raised on the terminal alone**, per its declaration.

## Consequences

- Updating the plugin updates the line, in the running session on reload. The
  whole class of 2.0.0 defects (stale copy, winner flips, frozen line after a
  disable) disappears with the machinery.
- Disabling or uninstalling the plugin removes the line. That is now the opt-out.
- The line exists only where mods draw: terminal and desktop. VS Code, `-p` and
  the SDK show nothing; 2.0.0's `statusLine` showed in some of those.
- The turn summary keeps one small record per turn in the shared `$.store`;
  sessions untouched for 30 days are pruned at start.
- A permission mode with a short label wastes up to 9 columns, the price of
  never reflowing onto a second row after a shift+tab.

## Alternatives rejected

- **`AbovePrompt`**: a row of its own, shared with surveys and every other mod.
- **Keeping a minimal `statusLine` beside the mod**: keeps all of ADR 0001's
  machinery for one line.
- **`$.ui.log` for a persistent turn summary**: a row per turn, unstyled, and
  read by nothing that survives a resume better than `$.store` does.
- **A dedicated row in narrow terminals**: narrow terminals are also short.
