import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { ContextBreakdown, ContextFull, ContextView } from '../types'
import { type Line, type Span, details, grid, legend, timeOfDay, tokens } from './context-view.js'

// The pane /context would be, toggled by /ctx, which the mod's session.start
// registers (an event takes one unmatched hook per plugin), and by a press on
// the footer's `press:ctx` Button. A plugin's own $.command.run skips its own
// hooks, so the press is taken here, before that Button's fallback runs /ctx.
// The summary is measured as the pane draws: the mod's invalidate on each
// measure keeps it live.

const PANE = 'context'

// What the docked pane takes from the footer's row, its border included: the
// footer's viewport, like the pane's own, is the transcript's width alone.
let docked = 0
export const dockedColumns = (): number => docked
const view = atom({ plugin: 'statusline', key: 'ctxView' } as const, 'summary' as ContextView)
const full = atom({ plugin: 'statusline', key: 'ctxFull' } as const, { status: 'none' } as ContextFull)
const unfolded = atom({ plugin: 'statusline', key: 'ctxUnfolded' } as const, [] as string[])

async function measureFull($: EngineInterface, columns: number): Promise<void> {
  // The count on screen stays while the next is taken: the estimate would flash in between
  await update($, full, (f): ContextFull => ({
    status: 'busy',
    previous: f.status === 'ready' ? { at: f.at, breakdown: f.breakdown } : f.status === 'busy' ? f.previous : undefined,
  }))
  let next: ContextFull
  try {
    const b = (await $.session.usage({ breakdown: 'full', columns })).context.breakdown
    next = b ? { status: 'ready', at: await $.clock.now(), breakdown: b } : { status: 'failed', reason: 'aucune session liée' }
  } catch (err) {
    next = { status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
  await update($, full, () => next)
}

const style = (s: Span) => ({
  ...(s.color ? { color: s.color } : {}),
  ...(s.dim ? { dimColor: true as const } : {}),
  ...(s.bold ? { bold: true as const } : {}),
})

/** Every opening starts on the summary: a full count kept from earlier may be old. */
async function toggle($: EngineInterface): Promise<void> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) return $.ui.close({ id: PANE })
  await update($, view, (): ContextView => 'summary')
  await $.ui.open({ id: PANE, title: 'Contexte' })
}

export function registerContextPane(on: Parameters<Register>[0]): void {
  on('command.run', { command: 'ctx' }, async $ => {
    await toggle($)
    return {}
  })

  on('ui.press', { plugin: 'statusline', element: 'press:ctx' }, async ($, e) => {
    await toggle($)
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = e.props.placement === 'dock' ? e.props.bodyColumns + 1 : 0
    if (width !== docked) {
      docked = width
      $.ui.invalidate('ui.render')
    }
    const columns = e.props.bodyColumns
    const v = await read($, view), f = await read($, full), open = await read($, unfolded)
    const counted = v !== 'full' ? undefined : f.status === 'ready' ? f : f.status === 'busy' ? f.previous : undefined
    let shown: ContextBreakdown | undefined = counted?.breakdown
    // The full view draws counts only: before the first, its controls say Calcul…
    if (v === 'summary') {
      try {
        shown = (await $.session.usage({ breakdown: 'summary', columns })).context.breakdown
      } catch {}
    }

    const lines = (ls: Line[]) => ls.map(l => Box({
      flexDirection: 'row',
      children: l.length ? l.map(sp => Text({ ...style(sp), children: [sp.text] })) : [Text({ children: [' '] })],
    }))
    const button = (key: string, label: string, onPress: () => Promise<unknown>) => Button({ key, label, onPress: () => void onPress() })
    const toSummary = button('ctx-summary', 'Résumé', () => update($, view, (): ContextView => 'summary'))
    const measure = (key: string, label: string) => button(key, label, async () => {
      await update($, view, (): ContextView => 'full')
      await measureFull($, columns)
    })

    const body = shown
      ? [Box({ flexDirection: 'row', columnGap: 3, children: [
          Box({ flexDirection: 'column', flexShrink: 0, children: lines(grid(shown)) }),
          Box({ flexDirection: 'column', children: lines(legend(shown, v === 'full')) }),
        ] })]
      : v === 'full' ? [] : [Text({ dimColor: true, children: ['Pas encore de mesure : elle vient avec la première réponse.'] })]

    const controls = []
    if (v === 'summary') controls.push(Box({ flexDirection: 'row', children: [measure('ctx-detail', 'Détail')] }))
    else if (f.status === 'busy' || f.status === 'none') controls.push(Text({ dimColor: true, children: [
      f.status === 'busy' && f.previous ? `Calculé à ${timeOfDay(f.previous.at)} · nouveau calcul…` : 'Calcul…',
    ] }))
    else if (f.status === 'failed') controls.push(
      Text({ color: 'error', children: [`Échec du calcul : ${f.reason}`] }),
      Box({ flexDirection: 'row', columnGap: 1, children: [measure('ctx-retry', 'Réessayer'), toSummary] }),
    )
    else {
      controls.push(Box({ flexDirection: 'row', columnGap: 1, children: [
        Text({ dimColor: true, children: [`Calculé à ${timeOfDay(f.at)}`] }), measure('ctx-refresh', 'Rafraîchir'), toSummary,
      ] }))
      for (const section of details(f.breakdown)) {
        const isOpen = open.includes(section.id)
        controls.push(Box({ flexDirection: 'column', children: [
          Box({ flexDirection: 'row', columnGap: 2, children: [
            Button({
              key: 'ctx-section:' + section.id, plain: true, label: (isOpen ? '▾ ' : '▸ ') + section.title,
              onPress: () => void update($, unfolded, ids => (ids.includes(section.id) ? ids.filter(id => id !== section.id) : [...ids, section.id])),
            }),
            Text({ dimColor: true, children: [tokens(section.tokens)] }),
          ] }),
          ...(isOpen ? section.rows.map(r => Box({ flexDirection: 'row', columnGap: 2, children: [
            Text({ children: ['    ' + r.label] }), Text({ dimColor: true, children: [tokens(r.tokens)] }),
          ] })) : []),
        ] }))
      }
    }

    return Box({ flexDirection: 'column', rowGap: 1, children: [...body, ...controls] })
  })
}
