# statusline

A Claude Code plugin that draws a rich status line with a **mod**: code that
runs inside Claude Code and draws into its interface, so it updates with the
plugin and writes nothing to install itself.

Each figure sits where it reads best:

- **Footer, right of the hint line** (always there):

  ```
  focus │ email │ branch ● │ Opus 5.5 │ xhigh │ ███ 25% ░░░ ↑49.5k/1.0M ⊞ │ ⟳ 12 │ $0.84 │ █ 6% ░ 2h16 │ █ 5% ░ 4d 17h
  ```

  - the engine's own modes (`focus`, `memory paused`), kept on the left
  - **email** and **git branch** with a dot when the tree has changes, both off by default
  - **model** and **effort**
  - **context gauge** on the absolute token scale, with `↑input/window` in the same colour,
    and **`⊞`**, which opens the context pane
  - **`⟳ N`**, the model requests of the main loop, on a green→red gradient
  - **total cost** of the session
  - **5-hour and 7-day rate-limit gauges**, each with the time until reset

- **Spinner**, while Claude works: `Baking · ⟳ 12…`
- **Under each turn**, beside `Baked for 14s`: `↑+12.3k ↓1.9k · ⟳ 4 · $0.12`,
  what that turn added to the context, its output tokens, its requests and its
  cost. It is kept, and comes back after `claude --resume`.
- **Context pane**, opened and closed by a click on `⊞` or by `/ctx`: the grid
  and categories of `/context`, kept live, from a local estimate. **Détail**
  counts them with the token-count API, as `/context` does, and adds the memory
  files, MCP servers, agents, skills and slash commands; that count is taken
  only on demand and kept until **Rafraîchir**.
- **Toast**, when a threshold is crossed upward: `🟧 Contexte ≥ 100.0k`,
  `🟥 Contexte ≥ 200.0k`, `🟥 5h ≥ 80 %`.

Rate-limit gauges are green below 50%, yellow from 50–79%, and red at 80% and
above. The context gauge and the request counter tier differently — see
[Session degradation](#session-degradation).

When the terminal narrows, the line switches to compact forms (shorter gauges,
`O5.5`, `↑49.5k`), then drops, in this order: email, git, `⟳`, effort, cost,
time to reset, rate-limit gauges, model. The context gauge and `⊞` never go.

## Requirements

Claude Code **v2.1.289 or later**, in the terminal or the desktop app. Mods draw
nothing in VS Code, in `claude -p`, or through the Agent SDK. The desktop app
has no turn summary, and draws the line in the band above the prompt, its
gauges as bars, leaving the model and the effort to its own footer.

## Usage

Install and enable the plugin; the line appears at once. Disabling or
uninstalling the plugin removes it.

Settings are the plugin's options, in `/plugin` (**Installed** → `statusline` →
configure) or under `pluginConfigs` in `~/.claude/settings.json`:

| Option | Default | Effect |
| --- | --- | --- |
| `ctx_warn` | `100000` | input tokens at which the context gauge turns yellow and a toast fires |
| `ctx_crit` | `200000` | input tokens at which it turns red; also the gauge's full scale |
| `turns_min` | `30` | the request counter stays green up to this |
| `turns_max` | `250` | it is fully red from this |
| `show_email` | `false` | show the signed-in account's email |
| `show_git` | `false` | show the branch and a dot when the tree has changes |

### Upgrading from 2.x or 1.x

Nothing to do. Earlier versions put a `statusLine` entry in
`~/.claude/settings.json`; at the first session start the plugin removes it,
leaving every other setting as it was, and says so in a toast. It does that only
when the entry is provably one it wrote: 2.0.0's guarded command, or the 1.x
path with a renderer this plugin shipped, or nothing, behind it. Any other
`statusLine` is yours and stays; if it looks like a status line of this kind, a
toast mentions it once.

Two leftovers are harmless and can be deleted by hand:
`~/.claude/statusline-plugin.json`, and on 1.x installs
`~/.claude/statusline-command.sh`.

## Session degradation

Two segments track how far a session has drifted from its best behaviour: the
context gauge and the turn counter. They measure different things and are meant
to be read side by side, because they call for different remedies — a full
context calls for `/compact`, a long loop calls for a fresh session.

### Loop turns (`⟳ N`)

`N` counts the model requests of the main loop since the session started (or
since the last `/clear`): **one API request per agent-loop iteration** — a model
call plus the tool calls it triggers. Sub-agent work is excluded.

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
honouring it would silently cap `ctx_crit` and paint a quarter-full
bar red on a tuned 1M window. The yellow tier at 100k has **no source at all** —
it is half the red tier, chosen because the one citable alternative (32K) would
leave nearly every real session permanently yellow.

### Tuning

The four anchors are the `ctx_warn`, `ctx_crit`, `turns_min` and `turns_max`
options above. Since the defaults are judgement calls, calibrating them on your
own sessions is expected rather than exceptional.

### Known gaps

- **`⟳ N` restarts from zero on `--resume`**, and when the mod reloads: it counts
  the requests it has seen, and nothing reports the earlier ones.

[cc]: https://arxiv.org/html/2603.24631v2
[lcb]: https://arxiv.org/abs/2511.13998
[cat]: https://arxiv.org/abs/2512.22087
[nl]: https://arxiv.org/html/2502.05167v3

## Development

The mod is `hooks/register.ts`; what it shows and how the line shrinks is the
pure `hooks/line.ts`, and the removal of earlier releases' entry is
`hooks/migrate.ts`. Where each figure goes, and the engine facts the code works
around, are in [ADR 0002](docs/adr/0002-the-status-line-is-a-mod.md).

Load the checkout with `--plugin-dir`; saving a file reloads the mod in the
running session. Silence a 2.x line still installed with `--settings`:

```sh
touch .statusline-dev-hold   # see below
claude --settings '{"statusLine":{"type":"command","command":"true"}}' --plugin-dir .
```

Loading the checkout also writes the engine's type declarations to
`.claude-plugin/types/` (gitignored), which `tsconfig.json` extends:

```sh
claude plugin validate .      # what the engine reads from the module
claude plugin test            # tests/*.test.ts, no session needed
npx -p typescript tsc -p .    # once a session has written the types
```

**The hand brake.** At session start the mod removes a 2.x or 1.x `statusLine`
entry from `~/.claude/settings.json`. Loaded from a checkout — with
`--plugin-dir`, or with the repository added as its own marketplace for an
acceptance run — it would remove yours. An empty `.statusline-dev-hold` at the
root of the checkout stops that; it is gitignored and only its existence is
read. Remove it to test the migration as a user gets it.
