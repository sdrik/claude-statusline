// Removes the statusLine entry an earlier release wrote, so the mod's line is
// not doubled by a frozen copy of the old one. The proofs are ADR 0001's: the
// entry is touched only when it is provably ours.

/** Sentinel of the guarded command 2.0.0 wrote; its presence proves the entry ours. */
export const GUARD_MARK = '⚠ renderer absent'

/** sha256 of every renderer released before 2.0.0, which installed to LEGACY. */
export const LEGACY_SHA256 = new Set([
  'b0a607d99dec6cc61cf4286fb6cd4ee318949ab84dc74a81c3dc5159439b52b4',
  '102bbd41a8070d41d781d3ca63ba6bf016b8f597d4e66408fc30405f7ca44f9a',
])

export type Ownership =
  | 'none' //    no statusLine entry
  | 'guarded' // 2.0.0's guarded command
  | 'legacy' //  the pre-2.0.0 path, and the file there is a renderer we shipped
  | 'orphan' //  the pre-2.0.0 path, and nothing there
  | 'foreign' // anything else: someone's own status line

/**
 * Who owns the entry. `legacySha` is the hash of the file at the pre-2.0.0 path,
 * `null` when there is none.
 */
export function classify(command: string | undefined, legacyPath: string, legacySha: string | null): Ownership {
  if (!command) return 'none'
  if (command.includes(GUARD_MARK)) return 'guarded'
  // The old installer's backup of the user's own script: the legacy path is a
  // substring of it, so it has to be ruled out first.
  if (command.includes('.pre-statusline-plugin.bak')) return 'foreign'
  if (command.includes('$HOME/.claude/statusline-command.sh') || command.includes(legacyPath)) {
    if (legacySha === null) return 'orphan'
    if (LEGACY_SHA256.has(legacySha)) return 'legacy'
  }
  return 'foreign'
}

/** `settings.json` without its statusLine, or null when it does not parse. */
export function withoutStatusLine(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const { statusLine: _, ...rest } = parsed as Record<string, unknown>
  return JSON.stringify(rest, null, 2) + '\n'
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
