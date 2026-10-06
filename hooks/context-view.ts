// What the context pane shows, from a /context breakdown. Pure: no engine, and
// nothing from the footer line, so the pane can leave for a mod of its own.

import type { ContextBreakdown } from '../types'

/** How a square is filled, for a surface that draws it as a shape rather than its glyph. */
export type Square = 'full' | 'partial' | 'free' | 'buffer'
/** One styled stretch of text; with `square`, one of /context's squares. */
export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean; square?: Square }
export type Line = Span[]
/** `id` stays put while `title` carries counts; `tokens` is the rows' sum. */
export type Section = { id: string; title: string; tokens: number; rows: { label: string; tokens: number; dim?: boolean }[] }

export const tokens = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n))

const share = (n: number, of: number): string => (of ? ((n / of) * 100).toFixed(1) : '0.0') + ' %'

/** /context's glyphs: a row's last square is drawn hollow under 0.7 full. */
function square(kind: ContextBreakdown['categories'][number]['kind'], fullness: number): Square {
  return kind === 'free' || kind === 'buffer' ? kind : fullness < 0.7 ? 'partial' : 'full'
}
const GLYPH: Record<Square, string> = { full: '⛁', partial: '⛀', free: '⛶', buffer: '⛝' }

// /context's theme keys as the desktop paints them (dark, sampled), since an Svg
// paints no key; `claude` and `permission` were absent from the sample.
const PAINT: Record<string, string> = {
  promptBorder: '#484847', inactive: '#c3c2b7', warning: '#db9300', claude: '#d97757', permission: '#b1b9f9',
  cyan_FOR_SUBAGENTS_ONLY: '#0891b2', green_FOR_SUBAGENTS_ONLY: '#16a34a', purple_FOR_SUBAGENTS_ONLY: '#827dbd',
}
const paint = (key: string | undefined): string => (key && (PAINT[key] ?? (key.startsWith('#') ? key : undefined))) || '#888888'

// A row's pitch is the legend's line height, so the two read side by side
const SQ = 15, GAP = 4

/** One square at (x, y): filled, half-filled, a dot for free space, hatched for the buffer. */
function squareAt(sq: Square, color: string, x: number, y: number): string {
  const c = paint(color), r = `x="${x + 0.5}" y="${y + 0.5}" width="${SQ - 1}" height="${SQ - 1}" rx="2"`
  if (sq === 'full') return `<rect ${r} fill="${c}"/>`
  if (sq === 'partial') return `<rect ${r} fill="none" stroke="${c}"/><rect x="${x + 0.5}" y="${y + SQ / 2}" width="${SQ - 1}" height="${SQ / 2 - 0.5}" rx="1" fill="${c}"/>`
  if (sq === 'free') return `<circle cx="${x + SQ / 2}" cy="${y + SQ / 2}" r="1.5" fill="${c}" fill-opacity="0.6"/>`
  return `<rect ${r} fill="none" stroke="${c}" stroke-opacity="0.8"/><path d="M${x + 3} ${y + 3}L${x + SQ - 3} ${y + SQ - 3}M${x + SQ - 3} ${y + 3}L${x + 3} ${y + SQ - 3}" stroke="${c}" stroke-opacity="0.8"/>`
}

const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

/** The grid as one drawing, for a surface whose font draws the glyphs as pictograms. */
export function gridSvg(b: ContextBreakdown): { source: string; width: number; height: number } {
  const kinds = new Map(b.categories.map(c => [c.name, c.kind]))
  const cols = Math.max(0, ...b.gridRows.map(r => r.length))
  const width = Math.max(1, cols * (SQ + GAP) - GAP), height = Math.max(1, b.gridRows.length * (SQ + GAP) - GAP)
  const body = b.gridRows.flatMap((row, j) => row.map((sq, i) =>
    squareAt(square(kinds.get(sq.categoryName) ?? 'used', sq.squareFullness), sq.color, i * (SQ + GAP), j * (SQ + GAP)))).join('')
  return { source: svg(width, height, body), width, height }
}

export function grid(b: ContextBreakdown): Line[] {
  const kinds = new Map(b.categories.map(c => [c.name, c.kind]))
  return b.gridRows.map(row => row.map((sq, i) => {
    const s = square(kinds.get(sq.categoryName) ?? 'used', sq.squareFullness)
    return { text: (i ? ' ' : '') + GLYPH[s], color: sq.color, square: s }
  }))
}

/**
 * Beside the grid: the model, the total, one row per category, the compaction
 * threshold. `isCounted` tells the API's count from the local estimate, which
 * runs well above it.
 */
export function legend(b: ContextBreakdown, isCounted: boolean): Line[] {
  const lines: Line[] = [
    [{ text: b.model, bold: true }],
    [
      { text: `${tokens(b.totalTokens)} / ${tokens(b.rawMaxTokens)} tokens (${b.percentage} %)` },
      { text: isCounted ? ' · compté' : ' · estimé', dim: true },
    ],
    [],
  ]
  for (const c of b.categories) {
    if (c.kind === 'deferred') lines.push([{ text: `  ${c.name} : ${tokens(c.tokens)} (différé)`, dim: true }])
    else lines.push([
      { text: GLYPH[square(c.kind, 1)] + ' ', color: c.color, square: square(c.kind, 1) },
      { text: c.name + ' : ' },
      { text: `${tokens(c.tokens)} (${share(c.tokens, b.rawMaxTokens)})`, dim: true },
    ])
  }
  lines.push([], [{
    text: b.isAutoCompactEnabled && b.autoCompactThreshold != null
      ? `Autocompact à ${tokens(b.autoCompactThreshold)}` : 'Autocompact désactivé',
    dim: true,
  }])
  return lines
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A server the engine names by its id alone, as the desktop's own are, is named by its first two tools. */
export function serverLabel(name: string, tools: readonly string[]): string {
  if (!UUID.test(name)) return name
  const short = tools.map(t => (t.startsWith(`mcp__${name}__`) ? t.slice(name.length + 7) : t))
  return `‹${short.slice(0, 2).join(', ')}${short.length > 2 ? '…' : ''}›`
}

const byTokens = <T extends { tokens: number }>(rows: T[]): T[] => [...rows].sort((a, b) => b.tokens - a.tokens)

/** What only the full count itemizes; empty sections are left out. */
export function details(b: ContextBreakdown): Section[] {
  const servers = new Map<string, { count: number; tokens: number; tools: string[] }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { count: 0, tokens: 0, tools: [] }
    servers.set(t.serverName, { count: s.count + 1, tokens: s.tokens + t.tokens, tools: [...s.tools, t.name] })
  }
  const sections: Omit<Section, 'tokens'>[] = [
    { id: 'memory', title: 'Fichiers mémoire', rows: byTokens(b.memoryFiles).map(f => ({ label: f.path, tokens: f.tokens })) },
    {
      id: 'mcp', title: 'Outils MCP',
      rows: byTokens([...servers].map(([name, s]) => ({
        label: `${serverLabel(name, s.tools)} (${s.count} outil${s.count > 1 ? 's' : ''})`, tokens: s.tokens, ...(UUID.test(name) ? { dim: true } : {}),
      }))),
    },
    { id: 'agents', title: 'Agents', rows: byTokens(b.agents).map(a => ({ label: `${a.agentType} (${a.source})`, tokens: a.tokens })) },
  ]
  if (b.skills) sections.push({
    id: 'skills', title: `Skills (${b.skills.includedSkills}/${b.skills.totalSkills})`,
    rows: byTokens(b.skills.skillFrontmatter).map(s => ({ label: s.name, tokens: s.tokens })),
  })
  if (b.slashCommands) sections.push({
    id: 'commands', title: 'Commandes slash',
    rows: [{ label: `${b.slashCommands.includedCommands}/${b.slashCommands.totalCommands} listées`, tokens: b.slashCommands.tokens }],
  })
  return sections.filter(s => s.rows.length).map(s => ({ ...s, tokens: s.rows.reduce((n, r) => n + r.tokens, 0) }))
}

/** `14:07:32`, in the clock's local time. */
export function timeOfDay(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
