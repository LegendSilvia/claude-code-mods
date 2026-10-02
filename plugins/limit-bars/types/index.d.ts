export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Info = { model: string; folder: string; percent?: number; tokens?: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    'limit-bars': { limits: Limit[]; info: Info | null; effort: string | null }
  }
}
