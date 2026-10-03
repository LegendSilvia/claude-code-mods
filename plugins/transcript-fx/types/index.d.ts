export type Part = 'tools' | 'spinner' | 'prompts' | 'footer' | 'rule'
export type Settings = Record<Part, boolean>

declare module 'claude-code' {
  interface PluginState {
    'transcript-fx': { settings: Settings; lastEnd: { at: number; durationMs: number } | null }
  }
}
