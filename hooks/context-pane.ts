import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { ContextBreakdown, ContextFull, ContextPane } from '../types'
import { type Line, type Span, details, grid, gridSvg, legend, timeOfDay, tokens } from './context-view.js'

// The pane /context would be, toggled by /ctx, which the mod's session.start
// registers (an event takes one unmatched hook per plugin), and by a press on
// the footer's `press:ctx` Button. A plugin's own $.command.run skips its own
// hooks, so the press is taken here, before that Button's fallback runs /ctx.
// The summary is measured as the pane draws: the mod's invalidate on each
// measure keeps it live.

const PANE = 'context'
// The details' rows: labels take what the numbers leave, numbers right-aligned
const ROW_MAX = 64, NUM_W = 7

// What the docked pane takes from the footer's row, its border included: the
// footer's viewport, like the pane's own, is the transcript's width alone.
let docked = 0
export const dockedColumns = (): number => docked
const pane = atom({ plugin: 'statusline', key: 'ctxPane' } as const, { view: 'summary', full: { status: 'none' } } as ContextPane)
// Past this, a count shows itself under way; quicker, the pane draws once, with its result
const BUSY_AFTER_MS = 300
const unfolded = atom({ plugin: 'statusline', key: 'ctxUnfolded' } as const, [] as string[])

/**
 * Opens the full view on a fresh count. The desktop keeps showing an earlier
 * tree of a quick run of redraws, whose presses then miss, so this writes once.
 */
async function measureFull($: EngineInterface, columns: number): Promise<void> {
  let done = false
  // The count on screen stays while the next is taken: the estimate would flash in between
  $.clock.after(BUSY_AFTER_MS, () => void (done || update($, pane, (p): ContextPane => ({
    view: 'full',
    full: { status: 'busy', previous: p.full.status === 'ready' ? { at: p.full.at, breakdown: p.full.breakdown } : p.full.status === 'busy' ? p.full.previous : undefined },
  }))))
  let next: ContextFull
  try {
    const b = (await $.session.usage({ breakdown: 'full', columns })).context.breakdown
    next = b ? { status: 'ready', at: await $.clock.now(), breakdown: b } : { status: 'failed', reason: 'aucune session liée' }
  } catch (err) {
    next = { status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
  done = true
  await update($, pane, (): ContextPane => ({ view: 'full', full: next }))
}

const style = (s: Span) => ({
  ...(s.color ? { color: s.color } : {}),
  ...(s.dim ? { dimColor: true as const } : {}),
  ...(s.bold ? { bold: true as const } : {}),
})

/** Every opening starts on the summary: a full count kept from earlier may be old. */
async function toggle($: EngineInterface, surface?: string): Promise<void> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) return $.ui.close({ id: PANE })
  await update($, pane, (p): ContextPane => ({ ...p, view: 'summary' }))
  // Opened unfocused, the desktop's first press refocuses it, and misses for that redraw.
  // The terminal's prompt keeps its keys.
  await $.ui.open({ id: PANE, title: 'Contexte', ...(surface === 'desktop' ? { focus: true as const } : {}) })
}

export function registerContextPane(on: Parameters<Register>[0]): void {
  on('command.run', { command: 'ctx' }, async $ => {
    await toggle($)
    return {}
  })

  on('ui.press', { plugin: 'statusline', element: 'press:ctx' }, async ($, e) => {
    await toggle($, e.surface)
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e), { Box, Text, Button } = els
    // The desktop's font draws /context's glyphs as pictograms: its grid is a drawing
    const Svg = e.surface === 'desktop' && 'Svg' in els ? els.Svg : undefined
    // Beside Texts an Svg is not drawn: the legend's squares are a geometric glyph
    const span = (sp: Span) => Text({ ...style(sp), children: [Svg && sp.square ? '■ ' : sp.text] })
    // Only the terminal's footer spans the docked pane: elsewhere the redraw would be a press missed
    const width = e.surface === 'terminal' && e.props.placement === 'dock' ? e.props.bodyColumns + 1 : 0
    if (width !== docked) {
      docked = width
      $.ui.invalidate('ui.render')
    }
    const columns = e.props.bodyColumns
    const { view: v, full: f } = await read($, pane), open = await read($, unfolded)
    const counted = v !== 'full' ? undefined : f.status === 'ready' ? f : f.status === 'busy' ? f.previous : undefined
    let shown: ContextBreakdown | undefined = counted?.breakdown
    // The full view draws counts only: before the first, its controls say Calcul…
    if (v === 'summary') {
      try {
        shown = (await $.session.usage({ breakdown: 'summary', columns })).context.breakdown
      } catch {}
    }

    const lines =(ls: Line[]) => ls.map(l => Box({
      flexDirection: 'row',
      children: l.length ? l.map(span) : [Text({ children: [' '] })],
    }))
    const row = (label: ReturnType<typeof Text>, n: number) => Box({ flexDirection: 'row', width: Math.min(columns, ROW_MAX), children: [
      Box({ flexGrow: 1, flexShrink: 1, children: [label] }),
      Box({ width: NUM_W, flexShrink: 0, justifyContent: 'flex-end', children: [Text({ dimColor: true, children: [tokens(n)] })] }),
    ] })
    const button = (key: string, label: string, onPress: () => Promise<unknown>) => Button({ key, label, onPress: () => void onPress() })
    const toSummary = button('ctx-view', 'Résumé', () => update($, pane, (p): ContextPane => ({ ...p, view: 'summary' })))
    const measure = (key: string, label: string) => button(key, label, () => measureFull($, columns))

    const body = shown
      ? [Box({ flexDirection: 'row', columnGap: 3, children: [
          Svg ? Box({ flexShrink: 0, children: [Svg({ ...gridSvg(shown), alt: `contexte : ${shown.percentage} % utilisés` })] })
            : Box({ flexDirection: 'column', flexShrink: 0, children: lines(grid(shown)) }),
          Box({ flexDirection: 'column', children: lines(legend(shown, v === 'full')) }),
        ] })]
      : v === 'full' ? [] : [Text({ dimColor: true, children: ['Pas encore de mesure : elle vient avec la première réponse.'] })]

    // One Button toggles the view, first in every state: a pressed Button that vanishes takes
    // the focus with it, and the desktop's redraw for that blur leaves its next press missed
    const toggleView = v === 'summary' ? button('ctx-view', 'Détail', () => measureFull($, columns)) : toSummary
    const controls = []
    if (v === 'summary') controls.push(Box({ flexDirection: 'row', children: [toggleView] }))
    else if (f.status === 'busy' || f.status === 'none') controls.push(Box({ flexDirection: 'row', columnGap: 1, children: [toggleView, Text({ dimColor: true, children: [
      f.status === 'busy' && f.previous ? `Calculé à ${timeOfDay(f.previous.at)} · nouveau calcul…` : 'Calcul…',
    ] })] }))
    else if (f.status === 'failed') controls.push(
      Box({ flexDirection: 'row', columnGap: 1, children: [toggleView, measure('ctx-retry', 'Réessayer')] }),
      Text({ color: 'error', children: [`Échec du calcul : ${f.reason}`] }),
    )
    else {
      controls.push(Box({ flexDirection: 'row', columnGap: 1, children: [
        toggleView, Text({ dimColor: true, children: [`Calculé à ${timeOfDay(f.at)}`] }), measure('ctx-refresh', 'Rafraîchir'),
      ] }))
      for (const section of details(f.breakdown)) {
        const isOpen = open.includes(section.id)
        controls.push(Box({ flexDirection: 'column', children: [
          row(Button({
            key: 'ctx-section:' + section.id, plain: true, label: (isOpen ? '▾ ' : '▸ ') + section.title,
            onPress: () => void update($, unfolded, ids => (ids.includes(section.id) ? ids.filter(id => id !== section.id) : [...ids, section.id])),
          }), section.tokens),
          ...(isOpen ? section.rows.map(r => row(
            Text({ wrap: 'truncate-end', ...(r.dim ? { dimColor: true } : {}), children: ['    ' + r.label] }), r.tokens,
          )) : []),
        ] }))
      }
    }

    return Box({ flexDirection: 'column', rowGap: 1, children: [...body, ...controls] })
  })
}
