import { expect, mock, test } from 'claude-code/testing'
import { details, grid, legend } from '../hooks/context-view.js'
import type { ContextBreakdown } from '../types'

const BREAKDOWN: ContextBreakdown = {
  model: 'claude-opus-5-5', totalTokens: 80100, rawMaxTokens: 200000, percentage: 40,
  isAutoCompactEnabled: true, autoCompactThreshold: 167000,
  categories: [
    { name: 'System prompt', tokens: 3200, color: 'promptBorder', kind: 'used' },
    { name: 'Messages', tokens: 76900, color: 'permission', kind: 'used' },
    { name: 'MCP tools', tokens: 9000, color: 'inactive', kind: 'deferred' },
    { name: 'Free space', tokens: 87000, color: 'inactive', kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', kind: 'buffer' },
  ],
  gridRows: [[
    { categoryName: 'System prompt', color: 'promptBorder', squareFullness: 1 },
    { categoryName: 'Messages', color: 'permission', squareFullness: 0.4 },
    { categoryName: 'Free space', color: 'inactive', squareFullness: 0 },
    { categoryName: 'Autocompact buffer', color: 'inactive', squareFullness: 1 },
  ]],
  memoryFiles: [{ path: '~/.claude/CLAUDE.md', tokens: 400 }, { path: './CLAUDE.md', tokens: 1200 }],
  mcpTools: [{ serverName: 'tfs', tokens: 500 }, { serverName: 'tfs', tokens: 700 }, { serverName: 'docs', tokens: 300 }],
  agents: [],
  skills: { includedSkills: 2, totalSkills: 3, skillFrontmatter: [{ name: 'tdd', tokens: 90 }, { name: 'grilling', tokens: 120 }] },
}
const PANE = { plugin: 'statusline', surface: 'terminal', component: 'Pane', requestId: 'context', viewport: { columns: 100, rows: 40 },
  props: { title: 'Contexte', isFocused: false, bodyColumns: 100, placement: 'dock' } } as any
const ctx = ($: any) => $.command.run({ command: 'ctx', args: '' })

/** The engine beneath the pane: its panes, and a usage answering each breakdown as `full` says. */
function stub(on: any, full: () => ContextBreakdown | Error = () => BREAKDOWN) {
  const panes = new Set<string>(), asked: (string | undefined)[] = []
  mock.clock(on, { now: Date.parse('2026-10-06T12:00:00Z') })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: 'Contexte', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($: unknown, e: { id: string }) => (panes.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: unknown, e: { id: string }) => (panes.delete(e.id), { value: undefined }))
  on('session.usage', ($: unknown, e: { breakdown?: string }) => {
    asked.push(e.breakdown)
    const b = e.breakdown === 'full' ? full() : { ...BREAKDOWN, totalTokens: 79000 }
    if (b instanceof Error) return { deny: b.message }
    return { value: { startedAt: 0, context: { tokens: 80100, window: 200000, percent: 40, breakdown: b }, rateLimits: [] } }
  })
  return { panes, asked }
}

const textOf = async (ui: any) => JSON.stringify(await ui.drawn())

test('the grid draws /context\'s glyphs in each row\'s colour', () => {
  expect(grid(BREAKDOWN)[0]!.map(s => s.text).join('')).toBe('⛁ ⛀ ⛶ ⛝')
  expect(grid(BREAKDOWN)[0]![1]!.color).toBe('permission')
})

test('the legend gives the total, every category and the compaction threshold', () => {
  const text = legend(BREAKDOWN, false).map(l => l.map(s => s.text).join('')).join('\n')
  expect(text).toContain('80.1k / 200.0k tokens (40 %) · estimé')
  expect(text).toContain('⛁ Messages : 76.9k (38.5 %)')
  expect(text).toContain('MCP tools : 9.0k (différé)')
  expect(text).toContain('Autocompact à 167.0k')
})

test('the details group MCP tools by server, largest first, and leave empty sections out', () => {
  const sections = details(BREAKDOWN)
  expect(sections.map(s => s.title)).toEqual(['Fichiers mémoire', 'Outils MCP', 'Skills (2/3)'])
  expect(sections.map(s => s.tokens)).toEqual([1600, 1500, 210])
  expect(sections[0]!.rows.map(r => r.label)).toEqual(['./CLAUDE.md', '~/.claude/CLAUDE.md'])
  expect(sections[1]!.rows).toEqual([{ label: 'tfs (2 outils)', tokens: 1200 }, { label: 'docs (1 outil)', tokens: 300 }])
})

test('/ctx opens the pane, and closes it when it is open', async ($, on) => {
  const { panes } = stub(on)
  await ctx($)
  expect([...panes]).toEqual(['context'])
  await ctx($)
  expect([...panes]).toEqual([])
})

test('the pane opens on the summary, and Détail counts in full until Résumé', async ($, on) => {
  const { asked } = stub(on)
  await ctx($)
  const ui = await $.ui.mount(PANE)
  expect(await textOf(ui)).toContain('79.0k / 200.0k')
  expect(asked).not.toContain('full')

  await ui.press({ key: 'ctx-detail' })
  const detail = await textOf(ui)
  expect(asked).toContain('full')
  expect(detail).toContain('80.1k / 200.0k')
  expect(detail).toContain('compté')
  expect(detail).not.toContain('79.0k')
  expect(detail).toContain('Calculé à')
  expect(detail).toContain('Outils MCP')
  expect(detail).not.toContain('tfs (2 outils)')

  await ui.press({ key: 'ctx-section:mcp' })
  expect(await textOf(ui)).toContain('tfs (2 outils)')
  await ui.press({ key: 'ctx-section:mcp' })
  expect(await textOf(ui)).not.toContain('tfs (2 outils)')

  await ui.press({ key: 'ctx-summary' })
  expect(await textOf(ui)).toContain('79.0k / 200.0k')
  expect(await textOf(ui)).not.toContain('Outils MCP')
})

test('a failed full count says why and offers to try again', async ($, on) => {
  let fails = true
  stub(on, () => (fails ? new Error('quota') : BREAKDOWN))
  await ctx($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'ctx-detail' })
  expect(await textOf(ui)).toContain('Échec du calcul')
  fails = false
  await ui.press({ key: 'ctx-retry' })
  expect(await textOf(ui)).toContain('Calculé à')
})

test('reopening the pane starts on the summary again', async ($, on) => {
  stub(on)
  await ctx($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'ctx-detail' })
  await ctx($)
  await ctx($)
  expect(await textOf(ui)).toContain('Détail')
  expect(await textOf(ui)).not.toContain('Calculé à')
})
