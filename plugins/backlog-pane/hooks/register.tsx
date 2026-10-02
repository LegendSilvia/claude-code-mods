import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Task } from '../types'

const PANE = 'backlog'
const POLL_MS = 4000
const board = atom({ plugin: 'backlog-pane', key: 'board' } as const, null as Board | null)

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

// the workspace's backlog folder: backlog/ or .backlog/ holding tasks/, in the project root or above it
async function findBacklog($: EngineInterface): Promise<string | null> {
  let dir = (await $.session.root()).replace(/[\\/]+$/, '')
  const sep = dir.includes('\\') ? '\\' : '/'
  for (let depth = 0; depth < 8 && dir; depth++) {
    for (const name of ['backlog', '.backlog']) {
      const candidate = `${dir}${sep}${name}`
      if (await $.fs.exists(`${candidate}${sep}tasks`).catch(() => false)) return candidate
    }
    const cut = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
    if (cut <= 0 || /^[A-Za-z]:$/.test(dir)) break
    dir = dir.slice(0, cut)
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

const STYLE = {
  active: { glyph: '◐', color: '#ffcb6b' },
  todo: { glyph: '○', color: '#b388ff' },
  other: { glyph: '◇', color: '#4dd0e1' },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({ name: 'backlog', description: "Show the workspace's Backlog.md tasks in a side pane" })
    const dir = await findBacklog($)
    if (!dir) return ran
    await scan($, dir)
    $.clock.every(POLL_MS, () => void scan($, dir).catch(() => undefined))
    void $.ui.open({ id: PANE, title: 'Backlog' })
    return ran
  })

  on('command.run', { command: 'backlog' }, async $ => {
    const found = (await read($, board)) ?? null
    if (!found) return { text: 'No backlog/ folder in this workspace or above it. Run `backlog init` to start one.' }
    await $.ui.open({ id: PANE, title: 'Backlog' })
    return { text: 'Backlog pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, board)
    if (!b) return <Text dimColor>No backlog in this workspace.</Text>
    const now = await $.clock.now()
    const open = b.statuses.filter(s => !DONE.test(s))
    // in-progress kinds first, then the rest in the board's own order
    const order = [...open.filter(s => ACTIVE.test(s)), ...open.filter(s => !ACTIVE.test(s))]
    const done = b.tasks.filter(t => DONE.test(t.status)).length
    let room = Math.max(6, (e.viewport?.rows ?? 30) - 4)

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
        {sections}
        <Text dimColor>
          {done > 0 ? `✓ ${done} done · ` : ''}backlog · updated {clock(b.readAt)}
        </Text>
      </Box>
    )
  })
}
