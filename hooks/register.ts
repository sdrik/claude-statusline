import type { EngineInterface, Register } from 'claude-code'
import {
  type Alerted, type Run, type Thresholds, type TurnSummary,
  type Piece, alerts, alertedFor, barSvg, ctxTier, fit, rampColor, summaryRuns, thirds,
} from './line.js'
import { dockedColumns, registerContextPane } from './context-pane.js'
import { classify, sha256, withoutStatusLine } from './migrate.js'

// Where each figure goes, and why, is ADR 0002. The engine facts this module
// works around are recorded there too.


type Measured = {
  tokens: number
  window?: number
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  costUsd?: number
}

const DEFAULTS = { ctx_warn: 100000, ctx_crit: 200000, turns_min: 30, turns_max: 250, show_email: false, show_git: false }
// No event reports the permission mode, so the footer's label is reserved at
// its widest: `⏵⏵ bypass permissions on`.
const MODE_LABEL_MAX = 24
const PRUNE_MS = 30 * 86400000

let cfg: Thresholds & { show_email: boolean; show_git: boolean } = DEFAULTS
let measured: Measured = { tokens: 0, rateLimits: [] }
let effort: string | number | undefined
let requests = 0
let email: string | null = null
let git: { branch: string; dirty: boolean } | null = null
let alerted: Alerted = { ctx: 0, five_hour: false, seven_day: false }
let turn: { ctx0: number; cost0: number; steps: number; out: number } | null = null
// A finished turn's summary waits under its duration until its line is drawn,
// then lives under that line's id, which survives a resume.
const pending = new Map<number, TurnSummary>()
let summaries: Record<string, TurnSummary> = {}
let storeKey = ''
let hintWidth = 0
let hasModeLabel = false

const fromUsage = (u: Awaited<ReturnType<EngineInterface['session']['usage']>>): Measured => ({
  tokens: u.context.tokens ?? 0, window: u.context.window, rateLimits: u.rateLimits, costUsd: u.cost?.usd,
})

async function home($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
}

async function readEmail($: EngineInterface): Promise<void> {
  const dir = cfg.show_email ? await home($) : undefined
  if (!dir) return
  try {
    email = JSON.parse(await $.fs.read(dir + '/.claude.json'))?.oauthAccount?.emailAddress ?? null
  } catch {
    email = null
  }
}

async function readGit($: EngineInterface): Promise<void> {
  if (!cfg.show_git) return
  try {
    const branch = await $.process.run(['git', 'branch', '--show-current'])
    if (branch.exitCode !== 0) return void (git = null)
    const status = await $.process.run(['git', 'status', '--porcelain'])
    git = { branch: branch.stdout.trim() || 'HEAD', dirty: status.stdout.trim() !== '' }
  } catch {
    git = null
  }
}

/**
 * Before the first request: the model's own setting, else the session's.
 * `/effort` keys modelSettings by the exact model id, so `claude-opus-5` is
 * another model than `claude-opus-5-5`, not a prefix of it.
 */
async function readEffort($: EngineInterface): Promise<void> {
  try {
    const s = (await $.settings.read()) as { effortLevel?: string; modelSettings?: Record<string, { effortLevel?: string }> }
    const model = (await $.session.model()).replace(/\[.*\]$/, '')
    effort = s.modelSettings?.[model]?.effortLevel || s.effortLevel || effort
  } catch {}
}

async function loadSummaries($: EngineInterface): Promise<void> {
  storeKey = 'turns:' + (await $.session.id())
  summaries = ((await $.store.get(storeKey)) as { turns?: Record<string, TurnSummary> } | undefined)?.turns ?? {}
}

async function pruneSummaries($: EngineInterface, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith('turns:') || key === storeKey) continue
    const at = ((await $.store.get(key)) as { at?: number } | undefined)?.at ?? 0
    if (now - at > PRUNE_MS) await $.store.delete(key)
  }
}

/**
 * Removes the statusLine entry an earlier release wrote, under ADR 0001's
 * proofs. A checkout carrying `.statusline-dev-hold` never does: loaded with
 * --plugin-dir it would strip the author's working entry.
 */
async function migrate($: EngineInterface): Promise<void> {
  if (await $.fs.exists($.plugin.root + '/.statusline-dev-hold')) return
  const dir = await home($)
  if (!dir) return
  const settingsPath = dir + '/.claude/settings.json', legacyPath = dir + '/.claude/statusline-command.sh'
  let text: string
  try {
    text = await $.fs.read(settingsPath)
  } catch {
    return
  }
  let command: string | undefined
  try {
    command = JSON.parse(text)?.statusLine?.command
  } catch {
    return
  }
  const legacySha = (await $.fs.exists(legacyPath)) ? await sha256(await $.fs.read(legacyPath)) : null
  const owner = classify(command, legacyPath, legacySha)
  if (owner === 'none') return
  if (owner === 'foreign') {
    // Said once per distinct entry: it may well be wanted beside this line.
    const seen = 'foreign:' + (await sha256(command ?? ''))
    if (await $.store.get(seen)) return
    await $.store.set(seen, true)
    if (command?.includes('statusline')) {
      $.ui.toast('settings.json garde une statusLine qui doublonne peut-être cette ligne : retirez-la si besoin', { timeoutMs: 12000 })
    }
    return
  }
  const rewritten = withoutStatusLine(text)
  if (rewritten === null) return
  await $.fs.write(settingsPath, rewritten)
  $.ui.toast(`statusLine de la version ${owner === 'guarded' ? '2.0.0' : '1.x'} retirée de settings.json`, { timeoutMs: 8000 })
}

/** The columns SessionMode has: what the footer's indent, mode label and hint leave. */
const available = (columns: number): number => columns - 2 - (hasModeLabel ? MODE_LABEL_MAX + 1 : 0) - hintWidth - 2

const style = (r: Run) => ({
  ...(r.dim ? { dimColor: true as const } : {}),
  ...(r.color ? { color: r.color } : {}),
  ...(r.bg ? { backgroundColor: r.bg } : {}),
  ...(r.bold ? { bold: true as const } : {}),
})

async function figures($: EngineInterface) {
  return {
    model: await $.session.model(), effort, email: cfg.show_email ? email : null, git: cfg.show_git ? git : null,
    tokens: measured.tokens, window: measured.window, requests, costUsd: measured.costUsd,
    rateLimits: measured.rateLimits, now: await $.clock.now(),
  }
}

type Leaves = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Text' | 'Button'>

/** A run as a Text, or as the Button running the slash command it names. */
const run = ($: EngineInterface, { Text, Button }: Leaves, r: Run) => r.press
  ? Button({ key: 'press:' + r.press, plain: true, label: r.text, ...(r.dim ? { dimColor: true } : {}), onPress: () => void $.command.run({ command: r.press! }).catch(() => {}) })
  : Text({ ...style(r), children: [r.text] })

export const register: Register = (on, options) => {
  cfg = { ...DEFAULTS, ...(options as Partial<typeof DEFAULTS>) }
  registerContextPane(on)

  on('session.start', async ($, e, next) => {
    measured = fromUsage(await $.session.usage())
    alerted = alertedFor(measured, cfg)
    await loadSummaries($)
    await Promise.all([readEmail($), readGit($), readEffort($)])
    // The engine pushes every gauge's change; only the time-left countdowns need a clock
    $.clock.every(30000, () => $.ui.invalidate('ui.render'))
    $.ui.invalidate('ui.render')
    await pruneSummaries($, await $.clock.now())
    await migrate($)
    // Served by context-pane.ts, the pane's module, which the footer's ⊞ runs
    await $.command.register({ name: 'ctx', description: 'Ouvre ou ferme le pane du contexte (grille de /context)', immediate: true })
    return next(e)
  })

  // /clear and /resume reach a mod only as session.end: no classic.* event does
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      requests = 0
      pending.clear()
      turn = null
      // usage() keeps the old window until the next response
      if (e.reason === 'clear') {
        measured = { ...measured, tokens: 0 }
        alerted = { ...alerted, ctx: 0 }
      }
      $.ui.invalidate('ui.render')
      $.clock.after(500, async () => {
        await loadSummaries($)
        $.ui.invalidate('ui.render')
      })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    measured = { tokens: e.context.tokens ?? 0, window: e.context.window, rateLimits: e.rateLimits, costUsd: e.cost?.usd }
    const a = alerts(measured, alerted, cfg)
    alerted = a.now
    if (a.text) $.ui.toast(a.text, { timeoutMs: 8000 })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const u = await $.session.usage()
    turn = { ctx0: u.context.tokens ?? 0, cost0: u.cost?.usd ?? 0, steps: 0, out: 0 }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const main = e.agentId == null
    if (main) {
      effort = e.effort ?? effort
      requests++
      if (turn) turn.steps++
      $.ui.invalidate('ui.render')
    }
    const result = yield* next(e)
    if (main && turn && result.usage) turn.out += result.usage.output_tokens
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId == null && turn) {
      const u = await $.session.usage()
      const ctx1 = u.context.tokens ?? turn.ctx0
      pending.set(e.durationMs, {
        dCtx: ctx1 - turn.ctx0, tier: ctxTier(ctx1, cfg), out: turn.out, steps: turn.steps,
        dCost: (u.cost?.usd ?? 0) - turn.cost0,
      })
      turn = null
      await readGit($)
      $.ui.invalidate('ui.render')
    }
    return out
  })

  // The permanent line, right of the footer; the engine's own modes stay on its left.
  // The desktop's footer is too narrow for it: there it is the band above the prompt.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'desktop') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const modes = e.props.modes.length ? [await next(e), Text({ dimColor: true, children: [' │ '] })] : []
    const modesWidth = e.props.modes.length ? e.props.modes.join(' & ').length + 3 : 0
    // The footer spans the docked pane too, though its viewport stops at the transcript
    const docked = (await $.ui.panes()).some(p => p.isShown) ? dockedColumns() : 0
    const runs = fit(await figures($), cfg, available(e.viewport?.columns ?? 120) + docked - modesWidth)
    return Box({ flexDirection: 'row', flexWrap: 'nowrap', children: [...modes, ...runs.map(r => run($, { Text, Button }, r))] })
  })

  // The desktop's line: its footer shows the model and the effort, and only the
  // band draws an Svg beside Texts, so its gauges are drawings
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e), { Box, Text, Button } = els
    if (!('Svg' in els)) return next(e)
    const { left, centre, right } = thirds(await figures($), cfg, e.props.bodyColumns, { bars: true, model: false })
    const draw = (p: Piece) => ('bar' in p ? els.Svg({ ...barSvg(p.bar), alt: p.bar.alt }) : run($, { Text, Button }, p))
    // The sides grow from nothing alike, so the centre is the band's
    const side = (ps: Piece[], justifyContent: 'flex-start' | 'flex-end') =>
      Box({ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', width: 0, flexGrow: 1, justifyContent, children: ps.map(draw) })
    return Box({ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', columnGap: 2, children: [
      side(left, 'flex-start'),
      Box({ flexDirection: 'row', flexShrink: 0, alignItems: 'center', children: centre.map(draw) }),
      side(right, 'flex-end'),
    ] })
  })

  // Passed through: measured only, because SessionMode shares its row
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // The hint offers shift+tab only while a mode label is drawn before it
    const label = e.props.hint.includes('shift+tab')
    if (e.props.hint.length !== hintWidth || label !== hasModeLabel) {
      hintWidth = e.props.hint.length
      hasModeLabel = label
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Live request count while Claude works; the suffix is plain text
  on('ui.render', { component: 'Spinner' }, async ($, e, next) =>
    requests ? next({ ...e, props: { ...e.props, suffix: ` · ⟳ ${requests}` + e.props.suffix } }) : next(e))

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    let s = summaries[e.requestId]
    const waiting = pending.get(e.props.durationMs)
    if (!s && waiting) {
      s = summaries[e.requestId] = waiting
      pending.delete(e.props.durationMs)
      await $.store.set(storeKey, { at: await $.clock.now(), turns: summaries })
    }
    if (!s) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const runs = summaryRuns(s, rampColor(s.steps, cfg))
    return Box({ flexDirection: 'row', columnGap: 1, children: [
      theirs,
      Box({ flexDirection: 'row', flexShrink: 0, children: runs.map(r => Text({ ...style(r), children: [r.text] })) }),
    ] })
  })
}
