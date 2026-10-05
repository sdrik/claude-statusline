import { expect, test } from 'claude-code/testing'
import { type Figures, alerts, alertedFor, fit, gauge, modelName, rampColor, timeLeft, tokens, width } from '../hooks/line.js'

const T = { ctx_warn: 100000, ctx_crit: 200000, turns_min: 30, turns_max: 250 }
const NOW = Date.parse('2026-10-05T12:00:00Z')
const FIGURES: Figures = {
  model: 'claude-opus-5-5', effort: 'medium', email: 'me@example.com', git: { branch: 'main', dirty: true },
  tokens: 111800, window: 1000000, requests: 10, costUsd: 1.94, now: NOW,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 2, resetsAt: '2026-10-05T15:30:00Z' },
    { kind: 'seven_day', percentUsed: 4, resetsAt: '2026-10-10T07:00:00Z' },
  ],
}
const text = (runs: { text: string }[]) => runs.map(r => r.text).join('')

test('tokens read like 2.0.0', () => {
  expect(tokens(999)).toBe('999')
  expect(tokens(111800)).toBe('111.8k')
  expect(tokens(1000000)).toBe('1.0M')
})

test('model ids shorten, compact or not', () => {
  expect(modelName('claude-opus-5-5', false)).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-5[1m]', true)).toBe('S5.5')
  expect(modelName('mystery', true)).toBe('mystery')
})

test('time left counts down in days, hours or minutes, and vanishes once past', () => {
  expect(timeLeft('2026-10-10T07:00:00Z', NOW)).toBe('4d 19h')
  expect(timeLeft('2026-10-05T14:14:30Z', NOW)).toBe('2h14')
  expect(timeLeft('2026-10-05T12:24:00Z', NOW)).toBe('24m')
  expect(timeLeft('2026-10-05T11:00:00Z', NOW)).toBe('')
  expect(timeLeft(undefined, NOW)).toBe('')
})

test('a gauge is as wide as asked, its percentage centred and clamped', () => {
  expect(text(gauge(56, 1, 13))).toBe('     56%     ')
  expect(text(gauge(140, 2, 5))).toBe('100% ')
  expect(gauge(56, 1, 13)[0]!.bg).toBe('#af8700')
})

test('the request ramp runs green to red between its bounds', () => {
  expect(rampColor(0, T)).toBe('#00af00')
  expect(rampColor(250, T)).toBe('#ff0000')
})

test('a wide line carries every figure in full', () => {
  const line = text(fit(FIGURES, T, 300))
  expect(line).toBe(
    'me@example.com │ main ● │ Opus 5.5 │ medium │      56%      ↑111.8k/1.0M │ ⟳ 10 │ $1.94 │      2%       3h30 │      4%       4d 19h',
  )
})

test('a narrower line goes compact before it drops anything', () => {
  const full = width(fit(FIGURES, T, 300))
  const line = text(fit(FIGURES, T, full - 1))
  expect(line).toContain('me@example.com')
  expect(line).toContain('O5.5')
  expect(line).toContain('↑111.8k │')
})

test('segments drop in the agreed order, and the context block never goes', () => {
  const seen: string[] = []
  for (let avail = 200; avail >= 0; avail--) {
    const line = text(fit(FIGURES, T, avail))
    const marks: [string, RegExp][] = [['email', /me@/], ['git', /main/], ['loops', /⟳/], ['effort', /medium/],
      ['cost', /\$/], ['times', /3h30/], ['rates', /2%/], ['model', /Opus 5\.5|O5\.5/]]
    for (const [name, mark] of marks) if (!mark.test(line) && !seen.includes(name)) seen.push(name)
    expect(line).toContain('↑111.8k')
  }
  expect(seen).toEqual(['email', 'git', 'loops', 'effort', 'cost', 'times', 'rates', 'model'])
})

test('before any reading the context gauge shows 0%', () => {
  expect(text(fit({ ...FIGURES, tokens: 0 }, T, 300))).toContain('0%       ↑0/1.0M')
})

test('one toast names every threshold crossed upward, once', () => {
  const quiet = alertedFor({ tokens: 0, rateLimits: [] }, T)
  const crossed = alerts({ tokens: 210000, rateLimits: [{ kind: 'five_hour', percentUsed: 83 }] }, quiet, T)
  expect(crossed.text).toBe('🟥 Contexte ≥ 200.0k · 🟥 5h ≥ 80 %')
  expect(alerts({ tokens: 220000, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] }, crossed.now, T).text).toBe('')
})

test('a threshold re-arms once the figure falls back', () => {
  const high = alertedFor({ tokens: 150000, rateLimits: [] }, T)
  const low = alerts({ tokens: 1000, rateLimits: [] }, high, T)
  expect(low.text).toBe('')
  expect(alerts({ tokens: 120000, rateLimits: [] }, low.now, T).text).toBe('🟧 Contexte ≥ 100.0k')
})
