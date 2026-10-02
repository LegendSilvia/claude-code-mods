import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Git, GitFile, Task } from '../types'

const PANE = 'backlog'
const POLL_MS = 4000
const board = atom({ plugin: 'backlog-pane', key: 'board' } as const, null as Board | null)
const git = atom({ plugin: 'backlog-pane', key: 'git' } as const, null as Git | null)

const DEFAULT_STATUSES = ['To Do', 'In Progress', 'Done']
const DONE = /^(done|completed?|closed)$/i
const ACTIVE = /progress|doing|review/i
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const unquote = (v: string) => {
  const s = v.trim()
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"')
  return s
}

// the scalar keys of a task file's front matter; folded (>-) and literal (|) blocks joined into one line
export function frontMatter(text: string): Record<string, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return {}
  const out: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '---') break
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, key, raw] = m as unknown as [string, string, string]
    if (/^[>|][-+]?$/.test(raw.trim())) {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) parts.push(lines[++i]!.trim())
      out[key] = parts.join(' ')
    } else if (raw.trim() !== '' && !raw.trim().startsWith('[')) {
      out[key] = unquote(raw)
    }
  }
  return out
}

export function toTask(text: string, fallbackId: string): Task | null {
  const f = frontMatter(text)
  if (!f.title || !f.status) return null
  return {
    id: f.id ?? fallbackId,
    title: f.title,
    status: f.status,
    priority: f.priority,
    parent: f.parent_task_id ?? f.parent,
    updated: f.updated_date ?? f.created_date,
    created: f.created_date,
    ordinal: f.ordinal !== undefined && !Number.isNaN(Number(f.ordinal)) ? Number(f.ordinal) : undefined,
  }
}

export function statusesOf(config: string): string[] {
  const m = /^statuses:\s*\[(.*)\]\s*$/m.exec(config.replace(/\r\n/g, '\n'))
  if (!m) return DEFAULT_STATUSES
  const list = m[1]!.split(',').map(unquote).filter(Boolean)
  return list.length > 0 ? list : DEFAULT_STATUSES
}

// "2026-09-17 13:19" → "1:19 PM" on the same day as now, "Sep 17" otherwise
export function when(stamp: string | undefined, now: number): string {
  const m = stamp && /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(stamp)
  if (!m) return ''
  const today = new Date(now)
  const isToday = Number(m[1]) === today.getFullYear() && Number(m[2]) === today.getMonth() + 1 && Number(m[3]) === today.getDate()
  if (isToday && m[4] !== undefined) {
    const h = Number(m[4])
    return `${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`
  }
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

const idNumber = (id: string) => Number(/(\d+(?:\.\d+)*)$/.exec(id)?.[1]?.split('.')[0] ?? 0)
export const byOrder = (a: Task, b: Task) =>
  (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity) || idNumber(a.id) - idNumber(b.id) || a.id.localeCompare(b.id)

const clock = (now: number) => {
  const d = new Date(now)
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// the folders a workspace's backlog may sit in: the project root, and above it only as far as
// the root's own git repository goes, so a folder of unrelated projects never lends its backlog
export function searchDirs(root: string, repoTop: string | null): string[] {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  const dirs = [root.replace(/[\\/]+$/, '')]
  if (repoTop === null) return dirs
  const top = norm(repoTop)
  let dir = dirs[0]!
  while (norm(dir) !== top && norm(dir).startsWith(`${top}/`)) {
    dir = dir.slice(0, Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\')))
    dirs.push(dir)
  }
  return dirs
}

// the workspace's backlog folder: backlog/ or .backlog/ holding tasks/, in one of the searchDirs
async function findBacklog($: EngineInterface): Promise<string | null> {
  const root = await $.session.root()
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 10000 }).catch(() => null)
  const top = r && r.exitCode === 0 ? r.stdout.trim() : null
  const sep = root.includes('\\') ? '\\' : '/'
  for (const dir of searchDirs(root, top)) {
    for (const name of ['backlog', '.backlog']) {
      const candidate = `${dir}${sep}${name}`
      if (await $.fs.exists(`${candidate}${sep}tasks`).catch(() => false)) return candidate
    }
  }
  return null
}

// what each task file last parsed to, by name and modified time, so a poll rereads only what changed
const cache = new Map<string, { mtimeMs: number; task: Task | null }>()
let signature = ''

async function scan($: EngineInterface, dir: string): Promise<void> {
  const sep = dir.includes('\\') ? '\\' : '/'
  const files = (await $.fs.list(`${dir}${sep}tasks`).catch(() => [])).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
  const sig = files.map(f => `${f.name}:${f.mtimeMs}`).sort().join('|')
  if (sig === signature) return
  signature = sig
  const tasks: Task[] = []
  for (const f of files) {
    let hit = cache.get(f.name)
    if (!hit || hit.mtimeMs !== f.mtimeMs) {
      const text = await $.fs.read(`${dir}${sep}tasks${sep}${f.name}`).catch(() => '')
      hit = { mtimeMs: f.mtimeMs, task: toTask(String(text), f.name.replace(/\.md$/, '')) }
      cache.set(f.name, hit)
    }
    if (hit.task) tasks.push(hit.task)
  }
  const config = await $.fs.read(`${dir}${sep}config.yml`).catch(() => '')
  const readAt = await $.clock.now()
  await update($, board, () => ({ dir, statuses: statusesOf(String(config)), tasks: tasks.sort(byOrder), readAt }))
}

// `git status --porcelain=v1 -b`: the branch line, then one line per changed path
export function parseGitStatus(out: string): Git {
  const lines = out.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  const branch =
    /^No commits yet on (.+)$/.exec(head)?.[1] ??
    (/^HEAD \(no branch\)/.test(head) ? 'detached' : head.split('...')[0]!.split(' ')[0] || '?')
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  const files: GitFile[] = lines.map(l => {
    const xy = l.slice(0, 2)
    const path = l.slice(3).split(' -> ').pop()!.replace(/^"(.*)"$/, '$1')
    const code = xy === '??' ? '?' : xy[0] !== ' ' ? xy[0]! : xy[1]!
    return { code, path }
  })
  return { branch, ahead, behind, files }
}

// the workspace's git state, or null where it is not a repository (or git is missing)
async function scanGit($: EngineInterface, cwd: string): Promise<void> {
  const r = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { cwd, timeoutMs: 10000 }).catch(() => null)
  const next = r && r.exitCode === 0 ? parseGitStatus(r.stdout) : null
  const prev = await read($, git)
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, git, () => next)
}

// the folder being polled, so a backlog created mid-session (backlog init) is picked up by /backlog
let watching: string | null = null
async function watch($: EngineInterface): Promise<string | null> {
  const dir = watching ?? (await findBacklog($))
  if (!dir) return null
  const root = await $.session.root()
  await scan($, dir)
  await scanGit($, root)
  if (watching === null) {
    watching = dir
    $.clock.every(POLL_MS, () => {
      void scan($, dir).catch(() => undefined)
      void scanGit($, root).catch(() => undefined)
    })
  }
  return dir
}

const GIT_CODE_COLOR: Record<string, string> = { M: '#ffcb6b', A: '#69f0ae', D: '#ff6b8b', R: '#b388ff', C: '#b388ff', U: '#ff6b8b', '?': '#69f0ae' }
const GIT_ROWS = 8

const STYLE = {
  active: { glyph: '◐', color: '#ffcb6b' },
  todo: { glyph: '○', color: '#b388ff' },
  other: { glyph: '◇', color: '#4dd0e1' },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({ name: 'backlog', description: "Show the workspace's Backlog.md tasks in a side pane" })
    if (await watch($)) void $.ui.open({ id: PANE, title: 'Backlog' })
    return ran
  })

  on('command.run', { command: 'backlog' }, async $ => {
    if (!(await watch($))) return { text: 'No backlog/ folder in this project (its root, or up to its git repository root). Run `backlog init` here to start one.' }
    await $.ui.open({ id: PANE, title: 'Backlog' })
    return { text: 'Backlog pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, board)
    if (!b) return <Text dimColor>No backlog in this workspace.</Text>
    const g = await read($, git)
    const now = await $.clock.now()
    const rule = <Text color="#3a3a42">{'─'.repeat(Math.max(4, (e.props.bodyColumns ?? 40) - 1))}</Text>
    const gitRows = g ? Math.min(g.files.length, GIT_ROWS) + (g.files.length > GIT_ROWS ? 1 : 0) : 0
    const gitSection = g ? (
      <Box key="git" flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="#69f0ae">
            ⎇ {g.branch}
          </Text>
          <Text dimColor>
            ↑{g.ahead} ↓{g.behind}
          </Text>
        </Box>
        {rule}
        {g.files.length === 0 ? <Text dimColor>✓ clean</Text> : null}
        {g.files.slice(0, GIT_ROWS).map((f, i) => (
          <Text key={`gf-${i}`} wrap="truncate-start">
            <Text bold color={GIT_CODE_COLOR[f.code] ?? '#4dd0e1'}>
              {f.code}
            </Text>{' '}
            {f.path}
          </Text>
        ))}
        {g.files.length > GIT_ROWS ? <Text dimColor>+{g.files.length - GIT_ROWS} more</Text> : null}
      </Box>
    ) : null
    const open = b.statuses.filter(s => !DONE.test(s))
    // in-progress kinds first, then the rest in the board's own order
    const order = [...open.filter(s => ACTIVE.test(s)), ...open.filter(s => !ACTIVE.test(s))]
    const done = b.tasks.filter(t => DONE.test(t.status)).length
    let room = Math.max(6, (e.viewport?.rows ?? 30) - 4 - (g ? gitRows + 3 : 0))

    const sections = order.map(status => {
      const list = b.tasks.filter(t => t.status === status)
      const kind = ACTIVE.test(status) ? 'active' : /to ?do|backlog|todo/i.test(status) ? 'todo' : 'other'
      const style = STYLE[kind]
      const label = kind === 'todo' ? 'Backlog' : status
      const perTask = kind === 'active' ? 3 : 1
      const fits = Math.max(1, Math.floor((room - 3) / perTask))
      const shown = list.slice(0, fits)
      room -= 3 + shown.length * perTask
      return (
        <Box key={`sec-${status}`} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={style.color}>
              {style.glyph} {label}
            </Text>
            <Text dimColor>{String(list.length)}</Text>
          </Box>
          <Text color="#3a3a42">{'─'.repeat(Math.max(4, (e.props.bodyColumns ?? 40) - 1))}</Text>
          {list.length === 0 ? <Text dimColor>nothing here</Text> : null}
          {shown.map(t =>
            kind === 'active' ? (
              <Box key={t.id} flexDirection="column" marginBottom={1}>
                <Text>
                  <Text color={style.color}>▸ </Text>
                  <Text bold>{t.title}</Text>
                </Text>
                <Text dimColor>
                  {'  '}
                  {t.id}
                  {t.updated ? ` · started ${when(t.updated, now)}` : ''}
                </Text>
              </Box>
            ) : (
              <Text key={t.id}>
                <Text color={style.color}>{t.parent ? '  ↳ ' : '· '}</Text>
                {t.priority === 'high' ? <Text color="#ff6b8b">! </Text> : null}
                {t.title}
              </Text>
            ),
          )}
          {list.length > shown.length ? <Text dimColor>+{list.length - shown.length} more</Text> : null}
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {gitSection}
        {sections}
        <Text dimColor>
          {done > 0 ? `✓ ${done} done · ` : ''}backlog · updated {clock(b.readAt)}
        </Text>
      </Box>
    )
  })
}
