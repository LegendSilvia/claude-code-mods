export type Task = {
  id: string
  title: string
  status: string
  priority?: string
  type?: string
  labels: string[]
  assignee: string[]
  ac: { done: number; total: number }
  parent?: string
  updated?: string
  created?: string
  ordinal?: number
}
export type Board = { dir: string; statuses: string[]; tasks: Task[]; readAt: number }
export type GitFile = { code: string; path: string }
export type Git = { branch: string; ahead: number; behind: number; files: GitFile[] }

declare module 'claude-code' {
  interface PluginState {
    'backlog-pane': { board: Board | null; git: Git | null; flash: string | null }
  }
}
