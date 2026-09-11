# statusline

A Claude Code plugin that installs a rich status line into your Claude Code
session. Once set up, the bottom status line shows, left to right:

```
email │ mode │ model │ effort │ context gauge │ loop turns │ 5h rate-limit gauge │ 7d rate-limit gauge
```

- **email** — the connected account's email (from `~/.claude.json`, falling back to `$CLAUDE_CODE_EMAIL`)
- **mode** — current permission mode (Plan mode / Accept edits / Bypass perms / Default mode)
- **model** — active model display name
- **effort** — reasoning effort level
- **context gauge** — a coloured bar reading on the absolute token scale, plus `↑input/window ↓output` tokens
- **loop turns** — `⟳ N`, the number of agent-loop iterations so far, on a green→red gradient
- **rate-limit gauges** — 5-hour and 7-day subscription usage bars, each with time until reset

Rate-limit gauges are green below 50%, yellow from 50–79%, and red at 80% and
above. The context gauge and the turn counter tier differently — see
[Session degradation](#session-degradation).

## Requirements

- `bash`
- `jq` — **required**; the status line silently renders nothing if `jq` is missing
- `awk`, `grep`, `tail`, `date`, `printf` — standard on Linux and macOS/BSD
- Claude Code **v2.1.251 or later** for the turn counter; on older versions
  every other segment still renders and `⟳ N` is simply absent

Works on Linux (GNU) and macOS/BSD.

## Usage

Enabling the plugin is all there is to it. The status line installs itself at
the start of your next session and keeps itself up to date from then on; there
is no setup command to run.

- `/statusline:status` — reports where the renderer is, which version is
  installed, whether your settings point at it, and whether it is stale. It only
  reports; it cannot install.

The status line refreshes after each assistant message, so it appears on the
next refresh once a session has started.

### What it writes, and when

**On every session start, unprompted and with your full privileges**, a
`SessionStart` hook:

1. copies the renderer into the plugin's own data directory
   (`~/.claude/plugins/data/statusline-<marketplace>/`);
2. adds a `statusLine` entry to `~/.claude/settings.json`, leaving every other
   setting untouched — **but only** if there is no `statusLine` entry, or the one
   there is provably the plugin's own (see below);
3. writes a pointer file, `~/.claude/statusline-plugin.json`, so
   `/statusline:status` can find the rest.

Hooks run without a sandbox and without a permission prompt — that is the
documented norm for every Claude Code plugin hook, not something special here.
It is stated plainly because it is a real change from earlier versions, which
only ever wrote when you ran `/statusline:setup`. Reading `hooks/sync.sh` before
you enable the plugin is the intended way to check that claim.

"Provably its own" means one of two things: the entry already names the current
destination, or it names the pre-2.0.0 path (`~/.claude/statusline-command.sh`)
*and* the file there is byte-for-byte a renderer this plugin shipped. Any other
`statusLine` value is left alone permanently. A renderer you took over and
edited yourself is therefore safe — and so is the
`statusline-command.sh.pre-statusline-plugin.bak` that the old installer may
have left in your `~/.claude`, which is never touched.

### Upgrading from 1.x

Nothing to do. The first session after the update recognises the old install by
its hash, repoints `settings.json` at the new location, and deletes the orphaned
`~/.claude/statusline-command.sh`. If the file there is *not* one this plugin
shipped, nothing is moved and nothing is deleted.

### Turning it off

**The opt-out is removing the `statusLine` entry from `~/.claude/settings.json`.**
Nothing else fully turns the status line off, and the two things that look like
they would are worth spelling out:

- **Disabling the plugin only freezes it.** A disabled plugin's hook does not
  run — but its data directory, the renderer inside it, and your `statusLine`
  entry pointing at that renderer all stay exactly where they are. The status
  line keeps rendering, at whatever version it had reached, forever.
- **Uninstalling** deletes the plugin's data directory, so the renderer goes
  with it; the `statusLine` entry left behind then prints a short notice telling
  you to remove it, rather than leaving the line silently blank.

**Order matters.** Remove the `statusLine` entry *first*, disable or uninstall
*second*. A disabled plugin takes its commands with it, so disabling first also
takes away `/statusline:status` — the one thing that could have told you your
settings still point at a frozen renderer.

- **Keep the plugin, no status line:** set `statusLine` to `{"type": "command",
  "command": "true"}` yourself. The hook sees an entry it cannot prove is its
  own and never touches it again.

### Customising the renderer

Editing the installed renderer is not a supported path — it is overwritten on
every update, by design, and its location says so. The supported ways to change
behaviour are the [`STATUSLINE_*` environment variables](#tuning) and, for
anything deeper, copying the renderer somewhere of your own and pointing
`statusLine` at your copy. The hook will then leave your entry alone.

### When something goes wrong

If the copy fails, the status line shows `⚠ /statusline:status` as its first
segment. That badge exists because the hook has no other channel: its output
would be injected into the model's context, so it stays silent and lets the
status line speak. Run `/statusline:status` for the detail.

## Session degradation

Two segments track how far a session has drifted from its best behaviour: the
context gauge and the turn counter. They measure different things and are meant
to be read side by side, because they call for different remedies — a full
context calls for `/compact`, a long loop calls for a fresh session.

### Loop turns (`⟳ N`)

`N` is `prompt_cache.requests` from the status line payload: **one API request
per agent-loop iteration** — a model call plus the tool calls it triggers.
Sub-agent work is excluded.

It is not a count of your prompts. Every prompt costs at least one model call so
`N` does rise by one or more when you send one, but one instruction that fans out
into forty tool calls moves it forty times as far as ten short exchanges do.
That gap is the point of the segment: a session that looks young in conversation
can already be deep in the loop.

There is no bar and no alarm, and that is deliberate:

- **The counter is a correlated symptom, not a cause.** The strongest published
  link between trajectory length and failure ([Coherence Collapse][cc], ρ=0.32,
  p=3.4×10⁻²³, 63.7% coherence collapse in the longest quartile against 21.7% in
  the shortest) comes with a warning from its own authors: agents "likely run
  longer because they are thrashing, not the reverse". Read `⟳ N` as a hint that
  something may be going wrong, never as a measurement of what is.
- **Degradation is continuous, with no cliff to alarm on.** Hence a gradient.

The anchors are **product choices**, not research results. The low anchor of 30
is the measured mean number of LLM invocations per trajectory for the strongest
frontier model on SWE-bench Verified (30.71), so green means "within the range
where models solve hard tasks". The high anchor of 250 puts saturation past the
quartile where coherence collapse triples.

Two published thresholds are deliberately **not** used. [LoCoBench-Agent][lcb]'s
12–15 turns is read off a six-point scatter plot with no confidence intervals,
against the paper's own composite efficiency metric rather than task success.
The ~60 rounds of [CaT][cat] is a context-exhaustion point for a 32B model with a
64k window and no context management at all — a token limit wearing a turn-shaped
label. Both fire near-permanently on real Claude Code sessions.

### Context gauge

The bar reads on the **absolute token scale**, `0 → CTX_CRIT`, not as a fraction
of the model's advertised window. Degradation tracks absolute tokens
([NoLiMa][nl]: 11 of 13 models advertising ≥128K fall below half their short-context
baseline by 32K), and "% of advertised window" has no primary backing as a
degradation metric — on a 1M-token window it would show a near-empty bar well
past the danger zone.

So the percentage inside the bar is the position on that absolute scale, **not**
the share of the window. The window share is still there, stated literally by
`↑input/window` right beside it: `↑150.0k/1.0M` next to a 75% bar means 150k
tokens used, three-quarters of the way to the 200k mark, on a 1M window.

Both token tiers are numbers we picked. The 200k red tier matches the threshold
Claude Code itself uses for `exceeds_200k_tokens`, but that flag is **not** read:
the harness derives it from this same token count against a hardcoded 200000, so
honouring it would silently cap `STATUSLINE_CTX_CRIT` and paint a quarter-full
bar red on a tuned 1M window. The yellow tier at 100k has **no source at all** —
it is half the red tier, chosen because the one citable alternative (32K) would
leave nearly every real session permanently yellow.

### Tuning

All four anchors are environment variables:

| Variable | Default | Effect |
| --- | --- | --- |
| `STATUSLINE_TURNS_MIN` | `30` | below this the counter stays green |
| `STATUSLINE_TURNS_MAX` | `250` | at or above this it saturates red |
| `STATUSLINE_CTX_WARN` | `100000` | tokens at which the gauge turns yellow |
| `STATUSLINE_CTX_CRIT` | `200000` | tokens at which it turns red; also the full-scale value |

Since the defaults are judgement calls, calibrating them on your own sessions is
expected rather than exceptional.

### Known gaps

- **Resumed sessions may under-report.** Claude Code documents `/clear` as
  resetting the request counter but says nothing about `--resume` or `--continue`.
  If it restarts from zero, `⟳ N` under-reports on a resumed session. Unverified.
- **`/compact` behaviour is undocumented** for the same counter, and likewise
  unverified here.

[cc]: https://arxiv.org/html/2603.24631v2
[lcb]: https://arxiv.org/abs/2511.13998
[cat]: https://arxiv.org/abs/2512.22087
[nl]: https://arxiv.org/html/2502.05167v3

## Development

Three suites, no dependencies beyond the ones the renderer itself needs:

- `bash tests/render.test.sh` — feeds synthetic payloads to the renderer and
  asserts on the escape sequences it emits.
- `bash tests/hook.test.sh` — runs the install hook in a throwaway `$HOME` with
  a fake plugin root and data directory, and asserts on what it wrote. Every
  branch that decides *whether* to write to `settings.json` is covered there,
  which is what justifies letting a hook write to `$HOME` at all.
- `bash tests/status.test.sh` — runs the diagnostic in a throwaway `$HOME` and
  asserts on what it tells the user. Every branch there answers "why is my
  status line not what I expect?", so a wrong answer sends someone to fix the
  wrong thing.

Loading a checkout with `--plugin-dir` is the supported development mode, and
the hook detects it: a checkout loaded that way gets a data directory named
`statusline-inline` rather than `statusline-<marketplace>`, and the hook bails
out on sight of it. Without that guard a checkout and a marketplace install
would resolve two different destinations and rewrite `settings.json` against
each other at every session start, leaving the status line alternating between
two renderers.

So `--plugin-dir` alone will not install anything. Point your settings at the
checkout directly instead. `.claude/settings.local.json` is gitignored, so it is
not in a fresh clone — create it with exactly this:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/statusline-command.sh\""
  }
}
```

Project settings win over user settings, and Claude Code reloads settings files
live, so an edit to the renderer shows up at the next refresh with no restart.
Running the renderer straight from the checkout leaves the `@@VERSION@@`
placeholder unsubstituted, which is harmless: with no witness file beside it,
the staleness badge has nothing to compare against and stays silent.

### Release acceptance, and the hand brake

`--plugin-dir` can never exercise the install hook end to end, by construction:
the hook bails out on the `-inline` data directory it produces. The only route
that gives the plugin a real identity and a real data directory is installing it
from a marketplace — and this repository is its own, so:

```sh
claude plugin marketplace add /path/to/claude-statusline
claude plugin install statusline@claude-statusline
```

**That install is not a sandbox.** A marketplace added by path does not run the
copy it caches: `CLAUDE_PLUGIN_ROOT` points at your working tree, and an edit
there takes effect at the very next session start, with no reinstall and no
`marketplace update`. A half-written `hooks/sync.sh` runs for real, against your
own `settings.json`, with your full privileges. So: install it for the
acceptance run, and uninstall it when you are done.

For the times you forget, there is a hand brake — create an empty
`.statusline-dev-hold` at the root of the checkout and the hook exits
immediately, before it can write anything:

```sh
touch .statusline-dev-hold
```

It is gitignored, only its existence is read, and its polarity is deliberate:
with nothing in place the hook behaves exactly as it does for a real user, so an
acceptance run with the file removed tests what actually ships.

Note that only one copy of a plugin loads at a time, even when the same name is
installed from several marketplaces — the winner is the first `<name>@<market>`
key in `enabledPlugins`. So installing this repository alongside another copy
does not run two hooks; it replaces which one runs.

## How it works

Claude Code plugins can't set the main status line declaratively — `statusLine`
is a user-only setting, with no plugin manifest key and no settings-merge
mechanism that could contribute one. So the plugin ships the renderer and
installs it into your user settings itself, the same way the built-in
`/statusline` command does.

The installation is driven by a `SessionStart` hook rather than by a command,
and that is forced by one fact: the destination lives under
`${CLAUDE_PLUGIN_DATA}`, and that variable exists **only** in hook
environments — it is absent from the environment of the Bash tool, so no
command a user can invoke is able to resolve it.

Earlier versions dodged this by copying the renderer to a fixed path from a
`/statusline:setup` command. The cost was that a plugin update had no effect
until you remembered to re-run that command, and nothing told you: the status
line just kept rendering old code indefinitely. Driving it from a hook removes
the manual step, and the version witness makes the remaining failure mode — a
copy that could not be written — visible instead of silent.
