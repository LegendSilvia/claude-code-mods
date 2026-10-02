export type Task = {
  id: string
  title: string
  status: string
  priority?: string
  parent?: string
  updated?: string
  created?: string
  ordinal?: number
}
export type Board = { dir: string; statuses: string[]; tasks: Task[]; readAt: number }

declare module 'claude-code' {
  interface PluginState {
    'backlog-pane': { board: Board | null }
  }
}
