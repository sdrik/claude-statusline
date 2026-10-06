// What the context pane shows, from a /context breakdown. Pure: no engine, and
// nothing from the footer line, so the pane can leave for a mod of its own.

import type { ContextBreakdown } from '../types'

/** One styled stretch of text. */
export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Line = Span[]
/** `id` stays put while `title` carries counts; `tokens` is the rows' sum. */
export type Section = { id: string; title: string; tokens: number; rows: { label: string; tokens: number }[] }

export const tokens = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n))

const share = (n: number, of: number): string => (of ? ((n / of) * 100).toFixed(1) : '0.0') + ' %'

/** /context's glyphs: a row's last square is drawn hollow under 0.7 full. */
function glyph(kind: ContextBreakdown['categories'][number]['kind'], fullness: number): string {
  if (kind === 'free') return '⛶'
  if (kind === 'buffer') return '⛝'
  return fullness < 0.7 ? '⛀' : '⛁'
}

export function grid(b: ContextBreakdown): Line[] {
  const kinds = new Map(b.categories.map(c => [c.name, c.kind]))
  return b.gridRows.map(row => row.map((sq, i) => ({
    text: (i ? ' ' : '') + glyph(kinds.get(sq.categoryName) ?? 'used', sq.squareFullness), color: sq.color,
  })))
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
      { text: glyph(c.kind, 1) + ' ', color: c.color },
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

const byTokens = <T extends { tokens: number }>(rows: T[]): T[] => [...rows].sort((a, b) => b.tokens - a.tokens)

/** What only the full count itemizes; empty sections are left out. */
export function details(b: ContextBreakdown): Section[] {
  const servers = new Map<string, { count: number; tokens: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { count: 0, tokens: 0 }
    servers.set(t.serverName, { count: s.count + 1, tokens: s.tokens + t.tokens })
  }
  const sections: Omit<Section, 'tokens'>[] = [
    { id: 'memory', title: 'Fichiers mémoire', rows: byTokens(b.memoryFiles).map(f => ({ label: f.path, tokens: f.tokens })) },
    {
      id: 'mcp', title: 'Outils MCP',
      rows: byTokens([...servers].map(([name, s]) => ({ label: `${name} (${s.count} outil${s.count > 1 ? 's' : ''})`, tokens: s.tokens }))),
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
