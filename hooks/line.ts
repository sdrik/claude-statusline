// What the permanent line shows and how it shrinks. Pure: no engine, no clock,
// so every rule here is unit-tested without a session.

export type Thresholds = { ctx_warn: number; ctx_crit: number; turns_min: number; turns_max: number }

/**
 * One styled stretch of text; the engine draws each as a Text, or as a Button
 * running the slash command `press` names, which draws no colour but `dim`.
 */
export type Run = { text: string; color?: string; bg?: string; bold?: boolean; dim?: boolean; press?: string }

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Figures = {
  model: string
  effort?: string | number
  email?: string | null
  git?: { branch: string; dirty: boolean } | null
  /** Input tokens of the live window; 0 before its first response. */
  tokens: number
  window?: number
  requests: number
  costUsd?: number
  rateLimits: readonly RateLimit[]
  now: number
}

// 2.0.0's palette: named colours follow the terminal's theme, the gauges keep
// their 256-colour codes as hex.
const GAUGE_BG = ['#008700', '#af8700', '#af0000'] // 28, 136, 124
const GAUGE_FG = '#eeeeee' // 255
const EMPTY_BG = '#444444' // 238
const EMPTY_FG = '#bcbcbc' // 250
const TIER_FG = ['green', 'yellow', 'red']
// 34 70 106 148 184 220 214 208 202 196
const RAMP = ['#00af00', '#5faf00', '#87af00', '#afd700', '#d7d700', '#ffd700', '#ffaf00', '#ff8700', '#ff5f00', '#ff0000']

/** Dropped one by one, in this order, once the compact forms no longer fit. */
export const DROP_ORDER = ['email', 'git', 'loops', 'effort', 'cost', 'times', 'rates', 'model'] as const
type Drop = (typeof DROP_ORDER)[number]

export const tokens = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n))

/** The context tiers on absolute tokens, not on the window: degradation tracks tokens. */
export const ctxTier = (n: number, t: Thresholds): number => (n >= t.ctx_crit ? 2 : n >= t.ctx_warn ? 1 : 0)
export const rateTier = (pct: number): number => (pct >= 80 ? 2 : pct >= 50 ? 1 : 0)
export const tierColor = (tier: number): string => TIER_FG[tier] ?? 'red'

export function rampColor(n: number, t: Thresholds): string {
  const x = t.turns_max <= t.turns_min ? 1 : Math.min(1, Math.max(0, (n - t.turns_min) / (t.turns_max - t.turns_min)))
  return RAMP[Math.round(x * 9)] ?? RAMP[9]!
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`, or `O5.5` compact; anything else as given. */
export function modelName(id: string, compact: boolean): string {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  if (!m) return id
  const family = m[1]![0]!.toUpperCase() + m[1]!.slice(1)
  return compact ? `${family[0]}${m[2]}.${m[3]}` : `${family} ${m[2]}.${m[3]}`
}

/** `4d 19h`, `2h14`, `24m`, or '' once past. */
export function timeLeft(iso: string | undefined, now: number): string {
  const at = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(at) || at <= now) return ''
  const s = Math.floor((at - now) / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`
}

/** A bar whose fill is the background, with the percentage centred on it. */
export function gauge(pct: number, tier: number, cells: number): Run[] {
  const p = Math.min(100, Math.max(0, Math.round(pct)))
  const label = `${p}%`, filled = Math.round((p / 100) * cells), start = Math.floor((cells - label.length) / 2)
  const runs: Run[] = []
  for (let i = 0; i < cells; i++) {
    const ch = i >= start && i < start + label.length ? label[i - start]! : ' '
    const fill = i < filled
    const last = runs[runs.length - 1]
    if (last && (last.bg === GAUGE_BG[tier]) === fill) last.text += ch
    else runs.push(fill ? { text: ch, color: GAUGE_FG, bg: GAUGE_BG[tier], bold: true } : { text: ch, color: EMPTY_FG, bg: EMPTY_BG })
  }
  return runs
}

/** A gauge drawn whole, as the desktop's Svg, `cells` wide: its runs would be split apart there. */
export type Bar = { bar: { pct: number; tier: number; cells: number; alt: string } }
export type Piece = Run | Bar

/**
 * How a surface draws the line: `bars`, gauges as drawings; `model`, false where
 * the surface shows the model and the effort itself.
 */
export type Style = { bars: boolean; model: boolean }
const TERMINAL: Style = { bars: false, model: true }

type Segment = { id: Exclude<Drop, 'times' | 'rates'> | 'ctx' | 'rate'; runs: Piece[]; time?: Run[] }

function segments(f: Figures, t: Thresholds, compact: boolean, st: Style): Segment[] {
  const cells = compact ? 5 : 13, out: Segment[] = []
  const meter = (pct: number, tier: number, alt: string): Piece[] => (st.bars ? [{ bar: { pct, tier, cells, alt } }] : gauge(pct, tier, cells))
  if (f.email) out.push({ id: 'email', runs: [{ text: f.email, color: 'cyan' }] })
  if (f.git) out.push({ id: 'git', runs: [{ text: f.git.branch, color: 'magenta' }, ...(f.git.dirty ? [{ text: ' ●', color: 'yellow' }] : [])] })
  if (st.model) out.push({ id: 'model', runs: [{ text: modelName(f.model, compact), color: 'blue' }] })
  if (st.model && f.effort != null) out.push({ id: 'effort', runs: [{ text: String(f.effort), color: 'yellow' }] })
  const ct = ctxTier(f.tokens, t)
  const io = ' ↑' + tokens(f.tokens) + (compact || !f.window ? '' : '/' + tokens(f.window))
  // A glyph of its own opens /context's pane: a Button would take the gauge's colours
  out.push({ id: 'ctx', runs: [
    ...meter((f.tokens / t.ctx_crit) * 100, ct, `contexte ${tokens(f.tokens)}`), { text: io, color: tierColor(ct) }, { text: ' ' }, { text: '⊞', dim: true, press: 'ctx' },
  ] })
  if (f.requests) out.push({ id: 'loops', runs: [{ text: `⟳ ${f.requests}`, color: rampColor(f.requests, t) }] })
  if (f.costUsd != null) out.push({ id: 'cost', runs: [{ text: '$' + f.costUsd.toFixed(2), color: 'green' }] })
  for (const kind of ['five_hour', 'seven_day']) {
    const r = f.rateLimits.find(x => x.kind === kind)
    if (!r) continue
    const tier = rateTier(Math.round(r.percentUsed)), left = timeLeft(r.resetsAt, f.now)
    const alt = `${kind === 'five_hour' ? '5h' : '7j'} ${Math.round(r.percentUsed)} %`
    out.push({ id: 'rate', runs: meter(r.percentUsed, tier, alt), time: left ? [{ text: ' ' + left, color: tierColor(tier) }] : [] })
  }
  return out
}

/** The kept segments, each with its pieces as drawn. */
function keep(list: Segment[], dropped: ReadonlySet<Drop>): { id: Segment['id']; pieces: Piece[] }[] {
  return list.filter(s => !dropped.has((s.id === 'rate' ? 'rates' : s.id) as Drop))
    .map(s => ({ id: s.id, pieces: [...s.runs, ...(s.time && !dropped.has('times') ? s.time : [])] }))
}

const join = (parts: { pieces: Piece[] }[]): Piece[] =>
  parts.flatMap((s, i) => (i ? [{ text: ' │ ', dim: true }, ...s.pieces] : s.pieces))

const assemble = (list: Segment[], dropped: ReadonlySet<Drop>): Piece[] => join(keep(list, dropped))

export const width = (runs: readonly Piece[]): number => runs.reduce((n, r) => n + ('bar' in r ? r.bar.cells : [...r.text].length), 0)

/**
 * The line for `avail` columns: full forms, then compact forms, then segments
 * dropped in DROP_ORDER. The context gauge, ↑input and ⊞ are never dropped, so the
 * result can still exceed a very small `avail`.
 */
export function fit(f: Figures, t: Thresholds, avail: number, st: Style & { bars: true }): Piece[]
export function fit(f: Figures, t: Thresholds, avail: number, st?: Style & { bars: false }): Run[]
export function fit(f: Figures, t: Thresholds, avail: number, st: Style = TERMINAL): Piece[] {
  return join(choose(f, t, avail, st))
}

function choose(f: Figures, t: Thresholds, avail: number, st: Style) {
  const full = segments(f, t, false, st)
  if (width(assemble(full, new Set())) <= avail) return keep(full, new Set())
  const compact = segments(f, t, true, st), dropped = new Set<Drop>()
  for (const d of DROP_ORDER) {
    if (width(assemble(compact, dropped)) <= avail) break
    dropped.add(d)
  }
  return keep(compact, dropped)
}

/**
 * The line fitted as `fit` does, split for a band: the context and what
 * precedes it on the left, the cost in the centre, the rate limits on the right.
 */
export function thirds(f: Figures, t: Thresholds, avail: number, st: Style): { left: Piece[]; centre: Piece[]; right: Piece[] } {
  const kept = choose(f, t, avail, st)
  return {
    left: join(kept.filter(s => s.id !== 'cost' && s.id !== 'rate')),
    centre: join(kept.filter(s => s.id === 'cost')),
    right: join(kept.filter(s => s.id === 'rate')),
  }
}

const BAR_H = 14
/** A bar's width in pixels for its `cells`: wide enough for `100%` when compact. */
export const barWidth = (cells: number): number => Math.max(40, Math.round(cells * 6.5))

/** The bar's markup: the fill in its tier's colour, the percentage centred, legible on either theme. */
export function barSvg(b: Bar['bar']): { source: string; width: number; height: number } {
  const w = barWidth(b.cells), p = Math.min(100, Math.max(0, Math.round(b.pct))), fill = Math.round((p / 100) * w)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${BAR_H}" viewBox="0 0 ${w} ${BAR_H}">`
    + `<rect width="${w}" height="${BAR_H}" rx="3" fill="rgba(128,128,128,0.25)"/>`
    + (fill ? `<rect width="${fill}" height="${BAR_H}" rx="3" fill="${GAUGE_BG[b.tier]}"/>` : '')
    + `<text x="${w / 2}" y="${BAR_H / 2}" dy="0.35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="700"`
    + ` fill="#ffffff" stroke="rgba(0,0,0,0.45)" stroke-width="2" paint-order="stroke">${p}%</text></svg>`
  return { source, width: w, height: BAR_H }
}

export type TurnSummary = { dCtx: number; tier: number; out: number; steps: number; dCost: number }

/** `↑+12.3k ↓1.9k · ⟳ 4 · $0.12`, drawn beside the engine's turn-duration line. */
export function summaryRuns(s: TurnSummary, rampAt: string): Run[] {
  const sign = s.dCtx >= 0 ? '+' : '−'
  return [
    { text: `↑${sign}${tokens(Math.abs(s.dCtx))}`, color: tierColor(s.tier) },
    { text: ` ↓${tokens(s.out)}` },
    { text: ' · ', dim: true },
    { text: `⟳ ${s.steps}`, color: rampAt },
    { text: ' · ', dim: true },
    { text: '$' + s.dCost.toFixed(2), color: 'green' },
  ]
}

export type Usage = { tokens: number; rateLimits: readonly RateLimit[] }
export type Alerted = { ctx: number; five_hour: boolean; seven_day: boolean }

/**
 * The toast for thresholds crossed upward since `was`, or '' when none, and the
 * state to remember. Crossings of one measurement share one toast: two toasts
 * raised in the same tick show only the first.
 */
export function alerts(u: Usage, was: Alerted, t: Thresholds): { text: string; now: Alerted } {
  const parts: string[] = [], tier = ctxTier(u.tokens, t)
  if (tier > was.ctx) parts.push(tier === 2 ? `🟥 Contexte ≥ ${tokens(t.ctx_crit)}` : `🟧 Contexte ≥ ${tokens(t.ctx_warn)}`)
  const now: Alerted = { ctx: tier, five_hour: false, seven_day: false }
  for (const kind of ['five_hour', 'seven_day'] as const) {
    now[kind] = (u.rateLimits.find(r => r.kind === kind)?.percentUsed ?? 0) >= 80
    if (now[kind] && !was[kind]) parts.push(`🟥 ${kind === 'five_hour' ? '5h' : '7d'} ≥ 80 %`)
  }
  return { text: parts.join(' · '), now }
}

/** Mutes the thresholds already crossed, so a start or a reload raises no toast. */
export const alertedFor = (u: Usage, t: Thresholds): Alerted => alerts(u, { ctx: 2, five_hour: true, seven_day: true }, t).now
