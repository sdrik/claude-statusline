import { expect, test } from 'claude-code/testing'
import { LEGACY_SHA256, classify, sha256, withoutStatusLine } from '../hooks/migrate.js'

const LEGACY = '/home/u/.claude/statusline-command.sh'
const SHIPPED = [...LEGACY_SHA256][0]!
const GUARDED = `[ -f "/d/statusline-command.sh" ] && exec bash "/d/statusline-command.sh" || printf '⚠ renderer absent — retirez statusLine'`

test('no entry, nothing to do', () => {
  expect(classify(undefined, LEGACY, null)).toBe('none')
})

test("2.0.0's guarded command is ours wherever it points", () => {
  expect(classify(GUARDED, LEGACY, null)).toBe('guarded')
})

test('the pre-2.0.0 path is ours only with a shipped renderer, or nothing, behind it', () => {
  expect(classify('bash $HOME/.claude/statusline-command.sh', LEGACY, SHIPPED)).toBe('legacy')
  expect(classify(`bash ${LEGACY}`, LEGACY, null)).toBe('orphan')
  expect(classify(`bash ${LEGACY}`, LEGACY, 'f'.repeat(64))).toBe('foreign')
})

test("the old installer's backup of the user's script stays theirs", () => {
  expect(classify(`bash ${LEGACY}.pre-statusline-plugin.bak`, LEGACY, SHIPPED)).toBe('foreign')
})

test("someone else's status line is foreign", () => {
  expect(classify('npx ccstatusline', LEGACY, null)).toBe('foreign')
})

test('removing the entry keeps every other setting', () => {
  const out = withoutStatusLine('{"model":"opus","statusLine":{"type":"command","command":"x"},"env":{"A":"1"}}')
  expect(JSON.parse(out!)).toEqual({ model: 'opus', env: { A: '1' } })
  expect(out!.endsWith('\n')).toBe(true)
})

test('a settings.json that does not parse is left alone', () => {
  expect(withoutStatusLine('{ nope')).toBe(null)
  expect(withoutStatusLine('[1]')).toBe(null)
})

test('sha256 hashes text as its UTF-8 bytes', async () => {
  expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
