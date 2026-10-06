// A contract imports nothing: the breakdown is the part of the engine's
// SessionContextBreakdown the context pane reads, which that type satisfies.

export type ContextBreakdown = {
  model: string
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  isAutoCompactEnabled: boolean
  autoCompactThreshold?: number
  categories: { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  gridRows: { categoryName: string; color: string; squareFullness: number }[][]
  memoryFiles: { path: string; tokens: number }[]
  mcpTools: { name: string; serverName: string; tokens: number }[]
  agents: { agentType: string; source: string; tokens: number }[]
  skills?: { includedSkills: number; totalSkills: number; skillFrontmatter: { name: string; tokens: number }[] }
  slashCommands?: { includedCommands: number; totalCommands: number; tokens: number }
}

export type ContextView = 'summary' | 'full'

/** The view and its count in one value: a press writes once, so the pane draws once. */
export type ContextPane = { view: ContextView; full: ContextFull }

/** The full count, which costs token-count API calls: taken on demand, then kept as is. */
export type ContextFull =
  | { status: 'none' }
  | { status: 'busy'; previous?: { at: number; breakdown: ContextBreakdown } }
  | { status: 'ready'; at: number; breakdown: ContextBreakdown }
  | { status: 'failed'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    statusline: {
      ctxPane: ContextPane
      /** The full view's sections shown unfolded, by `id`; folded by default. */
      ctxUnfolded: string[]
    }
  }
}
