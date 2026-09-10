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
- **loop turns** — `⟳N`, the number of agent-loop iterations so far, on a green→red gradient
- **rate-limit gauges** — 5-hour and 7-day subscription usage bars, each with time until reset

Rate-limit gauges are green below 50%, yellow from 50–79%, and red at 80% and
above. The context gauge and the turn counter tier differently — see
[Session degradation](#session-degradation).

## Requirements

- `bash`
- `jq` — **required**; the status line silently renders nothing if `jq` is missing
- `awk`, `grep`, `tail`, `date`, `printf` — standard on Linux and macOS/BSD
- Claude Code **v2.1.251 or later** for the turn counter; on older versions
  every other segment still renders and `⟳N` is simply absent

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

## Session degradation

Two segments track how far a session has drifted from its best behaviour: the
context gauge and the turn counter. They measure different things and are meant
to be read side by side, because they call for different remedies — a full
context calls for `/compact`, a long loop calls for a fresh session.

### Loop turns (`⟳N`)

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
  longer because they are thrashing, not the reverse". Read `⟳N` as a hint that
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
  If it restarts from zero, `⟳N` under-reports on a resumed session. Unverified.
- **`/compact` behaviour is undocumented** for the same counter, and likewise
  unverified here.

[cc]: https://arxiv.org/html/2603.24631v2
[lcb]: https://arxiv.org/abs/2511.13998
[cat]: https://arxiv.org/abs/2512.22087
[nl]: https://arxiv.org/html/2502.05167v3

## Development

`bash tests/render.test.sh` feeds synthetic payloads to the renderer and asserts
on the escape sequences it emits. No dependencies beyond the ones the renderer
itself needs.

## How it works

Claude Code plugins can't set the main status line declaratively (a plugin's own
`settings.json` only honours the `agent` and `subagentStatusLine` keys). So this
plugin ships the renderer script plus a small installer that writes the
`statusLine` entry into your user settings — the same approach the built-in
`/statusline` command uses. The renderer is copied to a stable path so it keeps
working across plugin updates.
