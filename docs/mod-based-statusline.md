> Superseded by [ADR 0002](adr/0002-the-status-line-is-a-mod.md): this note judged
> the spike's `AbovePrompt` band; 3.0.0 draws in `SessionMode` instead.

# Can this status line be a Claude Code mod?

Investigated 2026-09-17 against Claude Code **2.1.274**, with a working spike.
Function hooks are a preview feature; every fact below is dated to that build.

## Question

Can the renderer be reimplemented as a "Claude Code mod" — a function hook —
instead of a `statusLine` settings entry pointing at `scripts/statusline-command.sh`?

## Answer

**A mod can draw the whole line, in colour, with nearly all of the data. It cannot
put it where `statusLine` puts it.** The nearest slot is `AbovePrompt`, a band
*above* the prompt rather than the line below it. So this is not a drop-in
replacement; it is a different placement one has to prefer.

## Researched facts (sources: the type declarations, the announcement, the spike)

### Mods exist, behind a flag

- "Claude Mods" is the product name for a plugin that uses **function hooks**;
  "A mod is just a plugin that uses function hooks."
  ([anthropics/claude-code#91870](https://github.com/anthropics/claude-code/issues/91870),
  community update 2026-09-09)
- Opt in with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (same source). Committed to
  ship "on the scale of weeks"; the interface is still moving.
- A hooks module exports `register(on, options)`; hooks are `($, e, next)` and
  nest by registration order, Express-style.
- The three built-in mods ship their source at
  [`mods/`](https://github.com/anthropics/claude-code/tree/main/mods), and the
  declarations at `mods/types/claude-code.d.ts` (10772 lines) are the reference.
  Line numbers below are that file. `/plugin-types` regenerates it per build.

### The status line itself is not hookable

- `RenderComponent` (`:5937`) is the complete union `ui.render` fires on:
  `AskUserQuestion | UserMessage | AssistantMessage | ToolUse | ToolResult |
  ToolGroup | CommandOutput | Spinner | TurnDuration | InfoNotice | SessionMode |
  PromptHint | AbovePrompt | Pane`. **No `StatusLine` member.**
- The engine does dispatch the `statusLine` command through its hook machinery,
  as event `"StatusLine"` with subtype `"statusLine"` (strings in the 2.1.274
  binary, `/home/cschieli/.local/share/claude/versions/2.1.274`), but that event
  is not in the union a mod can hook.
- The row showing the token count and branch name, between the band and the
  prompt, is engine chrome with no component of its own — unreachable.
- A plugin still cannot declare `statusLine`; it remains a user-only setting.
  See `docs/adr/0001-installation-owned-by-the-session-hook.md`.

### The three slots a mod can draw in

| Slot | Where | Verdict |
| --- | --- | --- |
| `$.ui.status(text)` (`:1929`) | pinned beside the engine's notices | **No.** Rendered as a yellow notice prefixed `⚠<plugin-name>:`. A plugin badge, not a status line. The pin also outlives the module that set it, so a hot reload leaves a stale line on screen. |
| `PromptHint` (`:6562`) | the dim line under the prompt | **No.** Geographically right, but that line carries live engine state — running shells, available agents — and drawing over it destroys information. It also shakes: see below. |
| `AbovePrompt` (`:6575`) | band above the prompt, which the engine leaves empty | **Yes.** `bodyColumns`, `maxRows`, its own scroll, and a `hasSurvey` flag to yield when a survey takes the band. |

`SessionMode` (`:6506`), the dim labels at the right of the prompt footer, is the
only right-aligned hookable slot and costs no extra row — unexplored, and subject
to the same objection as `PromptHint`: it already carries engine state.

### What the data actually costs

`$` covers most of the renderer directly:

| Segment | Source |
| --- | --- |
| context gauge, rate-limit windows, cost | `$.session.usage()` (`:2191`) → `{ context, rateLimits, cost }`, documented as "what the status line has them" |
| model, cwd, session id, git repo | `$.session.model()` / `.cwd()` / `.id()` / `.repo()` (`:2130`–`:2151`) |
| user prompt count | `$.session.turns()` (`:2138`) — **not** the renderer's loop counter |

Three segments have no accessor and come from the session transcript, which
`$.fs.read` reaches because **`$.session.id()` is the transcript file's name**:

```
~/.claude/projects/<cwd with every non-alphanumeric turned into ->/<session-id>.jsonl
```

- **mode** — the last `permissionMode` row (what `scripts/statusline-command.sh`
  already does)
- **effort** — the last `effort` row. `CLAUDE_EFFORT` is documented (`:483`) as
  exported "to hook commands and Bash", but it is **absent from a function
  hook's environment** — verified empirically.
- **loop counter** — distinct `requestId`s

Only **output style** is unreachable by any route found: no accessor, nothing in
the declarations under `outputStyle`, `output style` or `displayName`.

### Two traps in the transcript

- **One request writes several rows carrying `usage`** — 213 rows for 130
  distinct `requestId`s in the session measured. Summing tokens naively
  overstates by ~65%. Deduplicate by `requestId` (or `message.id`) before any
  derived figure. This invalidated a first cost estimate of $22.69; the correct
  one was $13.72.
- **Subagents write elsewhere**: `<session-id>/subagents/agent-<id>.jsonl`, a
  directory beside the session file. They therefore never appear in the main
  transcript, and `isSidechain` is always absent there.

`$.session.usage().cost.usd` **does** include subagents — measured: engine $17.04
against $13.72 (main) + $3.61 (one research agent) computed independently. Do not
recompute cost from the transcript; read the engine's figure.

### `prompt_cache.requests` cannot be reproduced

The renderer's loop counter reads `prompt_cache.requests`. In the binary that
field is built inside
`prompt_cache:{warm, caching_observed, ttl, expires_at, requests, misses,
expected_rebuilds, hit_ratio, …}`, commented *"prompt-cache health for the main
conversation"*. It is the cache tracker's counter: it lives with the cache, which
has a `ttl` and an `expires_at`, and it resets on a rebuild. Nothing in the
transcript replays it — measured 71 (engine) against 115 (distinct `requestId`s).

For the segment's stated purpose — "a correlated symptom of a degrading session"
(`scripts/statusline-command.sh:196`) — the transcript's monotonic total is
arguably the better number, since degradation does not reset with the cache.

### Making a drawn line hold still

A tree that changes height or width at each paint shakes the screen. Three
distinct causes, each isolated by a scripted A/B with the phase name drawn at the
head of the line:

1. **A `Text` wraps by default.** One that wraps makes the row taller and the
   whole terminal jumps. Set `wrap: 'truncate-end'` on every `Text`, and a fixed
   `height` on the `Box`.
2. **A `Box` with an auto width** grows with its content and shoves the layout.
   Size it to `e.props.bodyColumns` — never to `e.viewport?.columns`, which is
   documented as absent until a surface has measured, so the width would flip
   between a number and auto.
3. **A periodic `$.ui.invalidate('ui.render')` repaints every hooked site, not
   just yours.** With `PromptHint` hooked, a 2 s clock shook the whole frame —
   proven with a *constant* tree, which shook identically. With `AbovePrompt`
   alone it is steady.

`ui.render` is memoised per input value (`:2869`), so a live gauge needs
*something* to ask for the repaint: a clock where that is safe, otherwise the
turn boundaries (`turn.start` / `turn.complete`), which is when the figures
actually move.

### Two API constraints worth knowing before writing

- `on()` takes a **string literal**, never a variable. A loop over a list of
  event names is refused by `claude plugin validate`, naming the line.
- `TextProps` (`:7832`) has **no `key`**; only `BoxProps` does (`:527`). A prop a
  component does not take makes the whole tree invalid, and the engine silently
  draws its own instead — with the reason in the `--debug` log, on a line
  beginning `ui.render (<Component>): a hook returned a tree that does not
  validate`. That log line is the first thing to read when a drawing vanishes.

## Recommendation

Keep shipping the shell renderer. The mod is a preview feature behind an env
flag whose interface is still moving, and `AbovePrompt` is a different placement,
not a substitute — adopting it is a product choice, not a port.

The spike lives on the `spike/mod-renderer` branch under `spikes/mod-renderer/`.
It touches nothing the plugin ships.

Two things would change the recommendation: preferring the band on its own
merits, or `StatusLine` appearing in `RenderComponent`, which would make the mod
genuinely substitutable.

## Vertical cost, for the record

`AbovePrompt` takes one row, two with a rule above it. But `statusLine` already
occupies a row below the prompt: dropping it frees that row, so the band alone is
**net zero** and the separator costs one.

## Unverified

- Whether `SessionMode` can carry a short line usefully.
- Whether a future build exposes `StatusLine` as a component.
- Whether `$.session.usage({ breakdown })` could replace the transcript read for
  any of the three missing segments — it was not tried.
