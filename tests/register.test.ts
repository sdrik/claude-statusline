import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/u'
const GUARDED = `[ -f "/d/statusline-command.sh" ] && exec bash "/d/statusline-command.sh" || printf '⚠ renderer absent — x'`
const USAGE = {
  startedAt: 0,
  context: { tokens: 49600, window: 1000000, percent: 5 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 6, resetsAt: '2026-10-05T14:00:00Z' }],
  cost: { usd: 0.11 },
}
const SESSION_MODE = (columns: number, modes: string[] = []) => ({
  plugin: 'statusline', component: 'SessionMode', surface: 'terminal', requestId: 'SessionMode',
  viewport: { columns, rows: 40 }, props: { modes },
}) as const

type Env = { panes?: object[]; settings?: string; files?: Record<string, string>; usage?: unknown; devHold?: boolean; settingsRead?: object }

/** Answers every call session.start makes; returns what the mod wrote and toasted. */
function stubSession(on: any, env: Env = {}) {
  const written: Record<string, string> = {}, toasts: string[] = [], store = new Map<string, unknown>()
  const files: Record<string, string> = { [HOME + '/.claude/settings.json']: env.settings ?? '{}', ...env.files }
  mock.clock(on, { now: Date.parse('2026-10-05T12:00:00Z') })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'sess-1' }))
  on('session.measure', ($: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  let usage: object = (env.usage as object | undefined) ?? USAGE
  on('session.usage', () => ({ value: usage }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: env.settingsRead ?? { effortLevel: 'medium', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } } }))
  on('env.get', ($: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: e.path in files || (!!env.devHold && e.path.endsWith('.statusline-dev-hold')) }))
  on('fs.read', ($: unknown, e: { path: string }) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.write', ($: unknown, e: { path: string; text: string }) => ((written[e.path] = e.text), { value: undefined }))
  on('store.get', ($: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($: unknown, e: { key: string }) => (store.delete(e.key), { value: undefined }))
  on('ui.toast', ($: unknown, e: { text: string }) => (toasts.push(e.text), { value: undefined }))
  on('ui.panes', () => ({ value: env.panes ?? [] }))
  const passed: Record<string, any> = {}
  on('ui.render', ($: unknown, e: { component: string; props: unknown }) => ((passed[e.component] = e.props), { type: 'Text', props: {}, children: ['engine'] }))
  return { written, toasts, store, passed, setUsage: (u: object) => void (usage = u) }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const lineOf = async (ui: any) => {
  const row = await ui.find({ type: 'Box' })
  return (row?.children ?? []).flatMap((c: any) => c.children ?? []).filter((x: unknown) => typeof x === 'string').join('')
}

test('the footer line carries the session figures, with the model\'s own effort', async ($, on) => {
  stubSession(on)
  await start($)
  const line = await lineOf(await $.ui.mount(SESSION_MODE(200)))
  expect(line).toContain('Opus 5.5 │ xhigh')
  expect(line).toContain('↑49.6k/1.0M')
  expect(line).toContain('$0.11')
  expect(line).toContain('2h00')
})

test("another model's effort setting is not this model's", async ($, on) => {
  stubSession(on, { settingsRead: { effortLevel: 'medium', modelSettings: { 'claude-opus-5': { effortLevel: 'xhigh' } } } })
  await start($)
  const line = await lineOf(await $.ui.mount(SESSION_MODE(200)))
  expect(line).toContain('Opus 5.5 │ medium')
})

test('the engine\'s own modes stay, on the left', async ($, on) => {
  stubSession(on)
  await start($)
  const ui = await $.ui.mount(SESSION_MODE(200, ['focus']))
  const row = await ui.find({ type: 'Box' })
  expect(row!.children[0]).toMatchObject({ type: 'Text', children: ['engine'] })
})

test('a narrow footer compacts the line', async ($, on) => {
  stubSession(on)
  await start($)
  const line = await lineOf(await $.ui.mount(SESSION_MODE(70)))
  expect(line).toContain('O5.5')
  expect(line).not.toContain('/1.0M')
})

test('a crossing measured mid-session raises one toast', async ($, on) => {
  const { toasts } = stubSession(on)
  await start($)
  await $.session.measure({
    context: { tokens: 205000, window: 1000000 }, changed: ['context', 'rateLimits'],
    rateLimits: [{ kind: 'seven_day', percentUsed: 81 }], cost: { usd: 3 },
  })
  expect(toasts).toEqual(['🟥 Contexte ≥ 200.0k · 🟥 7d ≥ 80 %'])
})

test('/clear empties the context gauge before the next response', async ($, on) => {
  stubSession(on)
  await start($)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  const line = await lineOf(await $.ui.mount(SESSION_MODE(200)))
  expect(line).toContain('0%')
  expect(line).toContain('↑0/1.0M')
})

test('the ⊞ beside the context gauge runs /ctx, which opens the pane', async ($, on) => {
  stubSession(on)
  const opened: string[] = []
  on('command.register', ($: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', ($: unknown, e: { id: string }) => (opened.push(e.id), { value: { isPlaced: true } }))
  await start($)
  const ui = await $.ui.mount(SESSION_MODE(200))
  expect(await ui.find({ type: 'Button', key: 'press:ctx' })).toBeDefined()
  await ui.press({ key: 'press:ctx' })
  expect(opened).toEqual(['context'])
})

test('a docked pane gives its width back to the footer, which spans it', async ($, on) => {
  stubSession(on, { panes: [{ id: 'context', title: 'Contexte', isShown: true, isFocused: false, isPlaced: true }] })
  await start($)
  await $.ui.mount({ plugin: 'statusline', surface: 'terminal', component: 'Pane', requestId: 'context', viewport: { columns: 146, rows: 40 },
    props: { title: 'Contexte', isFocused: false, bodyColumns: 89, placement: 'dock' } } as any)
  const line = await lineOf(await $.ui.mount(SESSION_MODE(146)))
  expect(line).toContain('Opus 5.5')
  expect(line).toContain('/1.0M')
})

test("2.0.0's statusLine entry is removed, the rest of settings.json kept", async ($, on) => {
  const { written, toasts } = stubSession(on, {
    settings: JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: GUARDED } }),
  })
  await start($)
  expect(JSON.parse(written[HOME + '/.claude/settings.json']!)).toEqual({ model: 'opus' })
  expect(toasts).toEqual(['statusLine de la version 2.0.0 retirée de settings.json'])
})

test("someone else's statusLine is never touched", async ($, on) => {
  const { written } = stubSession(on, {
    settings: JSON.stringify({ statusLine: { type: 'command', command: 'npx ccstatusline' } }),
  })
  await start($)
  expect(written).toEqual({})
})

test('a checkout holding .statusline-dev-hold migrates nothing', async ($, on) => {
  const { written } = stubSession(on, {
    settings: JSON.stringify({ statusLine: { type: 'command', command: GUARDED } }), devHold: true,
  })
  await start($)
  expect(written).toEqual({})
})

/** One main-loop request answered by the stub, read to its end. */
async function step($: any, turnId: string, index: number) {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1, effort: 'high' })
  let r = await stream.next()
  while (r.done !== true) r = await stream.next()
}

test('a turn counts its requests live and leaves its summary beside its duration line', async ($, on) => {
  const { setUsage, passed } = stubSession(on)
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }
  })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'lit README.md' })
  await step($, 't1', 0)
  await step($, 't1', 1)

  await $.ui.mount({ plugin: 'statusline', component: 'Spinner', surface: 'terminal', requestId: 'main',
    viewport: { columns: 120, rows: 40 }, props: { word: 'Baking', message: null, suffix: '…', mode: 'thinking' } })
  expect(passed.Spinner.suffix).toBe(' · ⟳ 2…')

  setUsage({ ...USAGE, context: { tokens: 61900, window: 1000000 }, cost: { usd: 0.23 } })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 7000, isAborted: false, reason: 'answer' })
  const line = await $.ui.mount({ plugin: 'statusline', component: 'TurnDuration', surface: 'terminal', requestId: 'msg-1',
    viewport: { columns: 120, rows: 40 }, props: { word: 'Baked', durationMs: 7000 } })
  const texts = (await line.find({ type: 'Box' }))
  expect(JSON.stringify(texts)).toContain('↑+12.3k')
  expect(JSON.stringify(texts)).toContain('↓1.8k')
  expect(JSON.stringify(texts)).toContain('⟳ 2')
  expect(JSON.stringify(texts)).toContain('$0.12')
})

test('on the desktop the line is the band above the prompt, its gauges drawings, the footer left to the desktop', async ($, on) => {
  stubSession(on)
  await start($)
  const footer = await $.ui.mount({ ...SESSION_MODE(200), surface: 'desktop' } as any)
  expect(JSON.stringify(await footer.drawn())).toContain('engine')
  const band = await $.ui.mount({
    plugin: 'statusline', component: 'AbovePrompt', surface: 'desktop', requestId: 'AbovePrompt', viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { bodyRows: 9 } },
  } as any)
  const drawn = JSON.stringify(await band.drawn())
  expect(await band.find({ type: 'Svg' })).toBeTruthy()
  expect(drawn).toContain('↑49.6k')
  expect(drawn).toContain('$0.11')
  expect(drawn).not.toContain('Opus')
  expect(drawn).not.toContain('xhigh')
})

test('the band yields to a survey, and stays the engine\'s on the terminal', async ($, on) => {
  stubSession(on)
  await start($)
  const props = { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { bodyRows: 9 } }
  const at = (surface: string, p: object) => $.ui.mount({ plugin: 'statusline', component: 'AbovePrompt', surface, requestId: 'AbovePrompt', viewport: { columns: 120, rows: 40 }, props: p } as any)
  expect(JSON.stringify(await (await at('desktop', props)).drawn())).not.toContain('↑')
  expect(JSON.stringify(await (await at('terminal', { ...props, hasSurvey: false })).drawn())).not.toContain('↑')
})
