import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Git, GitFile, Task } from '../types'

const PANE = 'backlog'
const POLL_MS = 4000
const board = atom({ plugin: 'backlog-pane', key: 'board' } as const, null as Board | null)
const git = atom({ plugin: 'backlog-pane', key: 'git' } as const, null as Git | null)
// the last action's outcome, shown in the footer: "TASK-3 started", or why a command failed
const flash = atom({ plugin: 'backlog-pane', key: 'flash' } as const, null as string | null)

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

const frontLines = (text: string): string[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return []
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  return lines.slice(1, end < 0 ? lines.length : end)
}

// the scalar keys of a task file's front matter; folded (>-) and literal (|) blocks joined into one line
export function frontMatter(text: string): Record<string, string> {
  const lines = frontLines(text)
  const out: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!)
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

// the list keys of the front matter, inline ([a, b]) or as "- item" lines beneath the key
export function frontLists(text: string): Record<string, string[]> {
  const lines = frontLines(text)
  const out: Record<string, string[]> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!)
    if (!m) continue
    const [, key, raw] = m as unknown as [string, string, string]
    const inline = /^\[(.*)\]$/.exec(raw.trim())
    if (inline) {
      out[key] = inline[1]!.split(',').map(unquote).filter(Boolean)
    } else if (raw.trim() === '') {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) items.push(unquote(lines[++i]!.replace(/^\s*-\s+/, '')))
      if (items.length > 0) out[key] = items
    }
  }
  return out
}

// checked and total acceptance criteria: "- [x] #1 ..." lines, inside the AC markers when present
export function acceptance(text: string): { done: number; total: number } {
  const body = text.replace(/\r\n/g, '\n')
  const marked = /<!-- AC:BEGIN -->([\s\S]*?)<!-- AC:END -->/.exec(body)
  const scope = marked ? marked[1]! : (/## Acceptance Criteria\n([\s\S]*?)(\n## |$)/.exec(body)?.[1] ?? '')
  const boxes = scope.match(/^\s*- \[[ xX]\]/gm) ?? []
  return { done: boxes.filter(b => /\[[xX]\]/.test(b)).length, total: boxes.length }
}

export function toTask(text: string, fallbackId: string): Task | null {
  const f = frontMatter(text)
  if (!f.title || !f.status) return null
  const l = frontLists(text)
  return {
    id: f.id ?? fallbackId,
    title: f.title,
    status: f.status,
    priority: f.priority,
    type: f.type,
    labels: l.labels ?? [],
    assignee: (l.assignee ?? (f.assignee ? [f.assignee] : [])).map(a => a.replace(/^@/, '')),
    ac: acceptance(text),
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

// the statuses the buttons move a task to: the board's first in-progress kind, and its last done kind
export const activeStatus = (statuses: string[]) => statuses.find(s => ACTIVE.test(s)) ?? 'In Progress'
export const doneStatus = (statuses: string[]) => [...statuses].reverse().find(s => DONE.test(s)) ?? 'Done'

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

const sepOf = (path: string) => (path.includes('\\') ? '\\' : '/')
const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

// the folders a workspace's backlog may sit in: the project root, and above it only as far as
// the root's own git repository goes, so a folder of unrelated projects never lends its backlog
export function searchDirs(root: string, repoTop: string | null): string[] {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  const dirs = [root.replace(/[\\/]+$/, '')]
  if (repoTop === null) return dirs
  const top = norm(repoTop)
  let dir = dirs[0]!
  while (norm(dir) !== top && norm(dir).startsWith(`${top}/`)) {
    dir = parentOf(dir)
    dirs.push(dir)
  }
  return dirs
}

async function findRepoTop($: EngineInterface, root: string): Promise<string | null> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 10000 }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout.trim() : null
}

// the workspace's backlog folder: backlog/ or .backlog/ holding tasks/, in one of the searchDirs
async function findBacklog($: EngineInterface, root: string, top: string | null): Promise<string | null> {
  const sep = sepOf(root)
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
  const sep = sepOf(dir)
  const files = (await $.fs.list(`${dir}${sep}tasks`).catch(() => [])).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
  // config.yml counts too: an edited status list shows without waiting on a task file
  const conf = await $.fs.stat(`${dir}${sep}config.yml`).catch(() => null)
  const sig = [...files.map(f => `${f.name}:${f.mtimeMs}`).sort(), `config.yml:${conf?.mtimeMs ?? 0}`].join('|')
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

// the workspace's git state, or null where it is not a repository (or git is missing); a poll
// never takes index.lock from the person's own git, and non-ASCII names come out as written
async function scanGit($: EngineInterface, cwd: string): Promise<void> {
  const argv = ['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-b']
  const r = await $.process.run(argv, { cwd, timeoutMs: 10000 }).catch(() => null)
  const next = r && r.exitCode === 0 ? parseGitStatus(r.stdout) : null
  const prev = await read($, git)
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, git, () => next)
}

// what is watched: the project root, its repo top (null outside git), and its backlog once found
let watched: { root: string; top: string | null; dir: string | null } | null = null

async function tick($: EngineInterface): Promise<void> {
  const w = watched
  if (!w) return
  // a backlog made later (backlog init) is found on the next tick
  if (!w.dir) w.dir = await findBacklog($, w.root, w.top)
  if (w.dir) await scan($, w.dir)
  if (w.top) await scanGit($, w.root)
}

// the timer's tick; skipped while the last one still runs, so a slow git never stacks up, and
// while the pane is closed, since nobody sees it (/backlog scans again as it reopens)
let isPolling = false
async function poll($: EngineInterface): Promise<void> {
  if (isPolling) return
  isPolling = true
  try {
    if ((await $.ui.panes()).some(p => p.id === PANE)) await tick($)
  } finally {
    isPolling = false
  }
}

// starts watching once, however many callers race to it (the session's start and an early
// /backlog); true when there is something to show (a backlog, or a git repository)
let starting: Promise<void> | null = null
async function watch($: EngineInterface): Promise<boolean> {
  if (!watched) {
    starting ??= (async () => {
      const root = await $.session.root()
      const top = await findRepoTop($, root)
      watched = { root, top, dir: await findBacklog($, root, top) }
      $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    })().finally(() => (starting = null))
    await starting
  }
  await tick($)
  return watched !== null && (watched.dir !== null || watched.top !== null)
}

// a Windows host: the paths the engine hands out start with a drive letter there
const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

// the backlog command as an argument vector: the binary on PATH, or on Windows the npm shim's
// node script, since a .cmd shim cannot run without a shell and a shell would reparse titles;
// a bare `backlog` on Windows resolves to that shim, so there only a full .exe path runs as is
let backlogArgv: string[] | null | undefined
async function backlogCommand($: EngineInterface, cwd: string): Promise<string[] | null> {
  if (backlogArgv !== undefined) return backlogArgv
  if (!isWindowsPath(cwd)) {
    const direct = await $.process.run(['backlog', '--version'], { cwd, timeoutMs: 15000 }).catch(() => null)
    return (backlogArgv = direct && direct.exitCode === 0 ? ['backlog'] : null)
  }
  const where = await $.process.run(['where', 'backlog'], { cwd, timeoutMs: 10000 }).catch(() => null)
  // the first hit Windows can start; npm's extensionless sh shim sits beside the .cmd and is skipped
  const hit = where && where.exitCode === 0 ? where.stdout.split(/\r?\n/).map(l => l.trim()).find(l => /\.(exe|cmd|bat)$/i.test(l)) : undefined
  if (hit && /\.exe$/i.test(hit)) return (backlogArgv = [hit])
  if (hit) {
    const script = `${parentOf(hit)}\\node_modules\\backlog.md\\cli.js`
    if (await $.fs.exists(script).catch(() => false)) return (backlogArgv = ['node', script])
  }
  return (backlogArgv = null)
}

// runs one backlog command in the project that holds the backlog, then rereads the board
async function runBacklog($: EngineInterface, args: string[], ok: string): Promise<void> {
  const dir = watched?.dir
  if (!dir) return
  const cwd = parentOf(dir)
  const argv = await backlogCommand($, cwd)
  if (!argv) {
    await update($, flash, () => 'backlog CLI not found on PATH')
    return
  }
  const r = await $.process.run([...argv, ...args], { cwd, timeoutMs: 30000 }).catch((err: unknown) => ({
    exitCode: -1,
    stdout: '',
    stderr: String(err),
  }))
  const why = (r.stderr || r.stdout).trim().split(/\r?\n/).pop() ?? ''
  await update($, flash, () => (r.exitCode === 0 ? ok : `failed: ${why || `exit ${r.exitCode}`}`))
  signature = ''
  await scan($, dir)
}

async function setStatus($: EngineInterface, id: string, to: 'start' | 'done'): Promise<void> {
  const b = await read($, board)
  if (!b) return
  // ids come from the repo's files; one that is not a plain name never reaches a command line
  if (!/^[\w.-]+$/.test(id)) {
    await update($, flash, () => `failed: refused odd task id ${JSON.stringify(id)}`)
    return
  }
  const status = to === 'start' ? activeStatus(b.statuses) : doneStatus(b.statuses)
  await runBacklog($, ['task', 'edit', id, '-s', status], `${id} ${to === 'start' ? 'started' : 'done'}`)
}

// the titles being created now: Enter pressed again before the CLI answers makes no second task
const creating = new Set<string>()
async function createTask($: EngineInterface, title: string): Promise<void> {
  const t = title.trim()
  if (!t || creating.has(t)) return
  creating.add(t)
  try {
    await runBacklog($, ['task', 'create', t], `created “${t}”`)
  } finally {
    creating.delete(t)
  }
}

const GIT_CODE_COLOR: Record<string, string> = { M: '#ffcb6b', A: '#69f0ae', D: '#ff6b8b', R: '#b388ff', C: '#b388ff', U: '#ff6b8b', '?': '#69f0ae' }
const GIT_ROWS = 8
const TYPE_COLOR: Record<string, string> = { bug: '#ff6b8b', feature: '#69f0ae', chore: '#4dd0e1', docs: '#82aaff', refactor: '#c792ea' }
const PRIORITY = { high: { glyph: '▲', color: '#ff6b8b' }, medium: { glyph: '◆', color: '#ffcb6b' }, low: { glyph: '▽', color: '#7a7a85' } } as const

const STYLE = {
  active: { glyph: '◐', color: '#ffcb6b' },
  todo: { glyph: '○', color: '#b388ff' },
  other: { glyph: '◇', color: '#4dd0e1' },
}

// a hue in degrees to #rrggbb, bright enough for a dark pane
function hue(h: number): string {
  const s = 0.85
  const l = 0.62
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const c = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return `#${[0, 8, 4].map(n => c(n).toString(16).padStart(2, '0')).join('')}`
}

// the acceptance criteria as a bar: the checked share drawn in a rainbow, the rest a dim track
export function acBar(done: number, total: number, width: number): { filled: number; colors: string[] } {
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * width) : 0
  return { filled, colors: Array.from({ length: filled }, (_, i) => hue((i / Math.max(1, width - 1)) * 300)) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({ name: 'backlog', description: "Show the project's git status and Backlog.md tasks in a side pane" })
    // the first scan runs on its own, so the first prompt never waits on git
    void watch($)
      .then(found => (found ? $.ui.open({ id: PANE, title: 'Workspace' }) : undefined))
      .catch(() => undefined)
    return ran
  })

  on('command.run', { command: 'backlog' }, async $ => {
    if (!(await watch($))) return { text: 'Nothing to show: this project has no backlog/ folder and is not a git repository.' }
    await $.ui.open({ id: PANE, title: 'Workspace' })
    return { text: 'Workspace pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // the mobile surface has no Input; the new-task box is left out there
    const Input = 'Input' in table ? table.Input : null
    const b = await read($, board)
    const g = await read($, git)
    const note = await read($, flash)
    const now = await $.clock.now()
    const cols = Math.max(20, e.props.bodyColumns ?? 40)
    // a rounded card in one colour, its title and count on the first row inside: the border
    // draws over anything laid on it, so a title set into the edge never shows
    const card = (id: string, color: string, title: unknown, count: unknown, body: unknown) => (
      <Box key={`card-${id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginBottom={1}>
        {title ? (
          <Box key={`head-${id}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}>{title}</Box>
            {count ? <Box flexShrink={0}>{count}</Box> : null}
          </Box>
        ) : null}
        {body}
      </Box>
    )

    const gitRows = g ? Math.min(g.files.length, GIT_ROWS) + (g.files.length > GIT_ROWS ? 1 : 0) : 0
    const gitSection = g
      ? card(
          'git',
          '#69f0ae',
          <Text bold color="#69f0ae">
            ⎇ {g.branch}
          </Text>,
          <Text dimColor>
            ↑{g.ahead} ↓{g.behind}
          </Text>,
          <>
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
          </>,
        )
      : null

    if (!b) {
      return (
        <Box flexDirection="column">
          {gitSection}
          <Text dimColor>No backlog here yet. Run `backlog init` in the project; it appears on its own.</Text>
        </Box>
      )
    }

    // priority, type and first label, in front of a title
    const chips = (t: Task) => {
      const p = t.priority ? PRIORITY[t.priority as keyof typeof PRIORITY] : undefined
      const out = []
      if (p) out.push(<Text key={`p-${t.id}`} color={p.color}>{`${p.glyph} `}</Text>)
      if (t.type) out.push(<Text key={`ty-${t.id}`} bold color={TYPE_COLOR[t.type] ?? '#4dd0e1'}>{`${t.type} `}</Text>)
      if (t.labels[0]) out.push(<Text key={`lb-${t.id}`} color="#8f7fd6">{`#${t.labels[0]} `}</Text>)
      return out
    }

    const open = b.statuses.filter(s => !DONE.test(s))
    // in-progress kinds first, then the rest in the board's own order
    const order = [...open.filter(s => ACTIVE.test(s)), ...open.filter(s => !ACTIVE.test(s))]
    const done = b.tasks.filter(t => DONE.test(t.status)).length
    let room = Math.max(6, (e.viewport?.rows ?? 30) - 9 - (g ? gitRows + 4 : 0))

    const sections = order.map(status => {
      const list = b.tasks.filter(t => t.status === status)
      const kind = ACTIVE.test(status) ? 'active' : /to ?do|backlog|todo/i.test(status) ? 'todo' : 'other'
      const style = STYLE[kind]
      const label = kind === 'todo' ? 'Backlog' : status
      const perTask = kind === 'active' ? 4 : 1
      const fits = Math.max(1, Math.floor((room - 4) / perTask))
      const shown = list.slice(0, fits)
      room -= 4 + shown.length * perTask
      return card(
        status,
        style.color,
        <Text bold color={style.color}>
          {style.glyph} {label}
        </Text>,
        <Text dimColor>{String(list.length)}</Text>,
        <>
          {list.length === 0 ? <Text dimColor>nothing here</Text> : null}
          {shown.map(t => {
            if (kind === 'active') {
              const bar = acBar(t.ac.done, t.ac.total, cols - 6)
              return (
                <Box key={t.id} flexDirection="column" marginBottom={1}>
                  <Box flexDirection="row" justifyContent="space-between" gap={1}>
                    <Box flexShrink={1}>
                      <Text>
                        <Text color={style.color}>▸ </Text>
                        {chips(t)}
                        <Text bold>{t.title}</Text>
                      </Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Button key={`done-${t.id}`} label="✓ done" onPress={() => void setStatus($, t.id, 'done')} />
                    </Box>
                  </Box>
                  {t.ac.total > 0 ? (
                    <Text>
                      {'  '}
                      {bar.colors.map((c, i) => (
                        <Text key={`ab-${t.id}-${i}`} color={c}>
                          ━
                        </Text>
                      ))}
                      <Text color="#3a3a42">{'─'.repeat(Math.max(0, cols - 6 - bar.filled))}</Text>
                    </Text>
                  ) : null}
                  <Text dimColor>
                    {'  '}
                    {[
                      t.id,
                      t.updated ? `started ${when(t.updated, now)}` : '',
                      t.ac.total > 0 ? `${t.ac.done}/${t.ac.total} criteria` : '',
                      t.assignee.join(', '),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </Box>
              )
            }
            return (
              <Box key={t.id} flexDirection="row" justifyContent="space-between" gap={1}>
                <Box flexShrink={1}>
                  <Text>
                    <Text color={style.color}>{t.parent ? '  ↳ ' : '· '}</Text>
                    {chips(t)}
                    {t.title}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Button key={`start-${t.id}`} plain dimColor label="▸ start" onPress={() => void setStatus($, t.id, 'start')} />
                </Box>
              </Box>
            )
          })}
          {list.length > shown.length ? <Text dimColor>+{list.length - shown.length} more</Text> : null}
        </>,
      )
    })

    return (
      <Box flexDirection="column">
        {gitSection}
        {sections}
        {Input
          ? card(
              'new',
              '#4dd0e1',
              null,
              null,
              <Input key="new-task" placeholder="new task title…" submitLabel="add" onSubmit={(value: string) => void createTask($, value)} />,
            )
          : null}
        <Text dimColor>
          <Text color="#69f0ae">✓ {done} done</Text> · backlog.md synced {clock(b.readAt)}
        </Text>
        {note ? <Text color={note.startsWith('failed') ? '#ff6b8b' : '#69f0ae'}>{note}</Text> : null}
      </Box>
    )
  })
}
