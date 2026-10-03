import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Part, Settings } from '../types'

export type { Part, Settings }

export const PARTS: readonly Part[] = ['tools', 'spinner', 'prompts', 'footer', 'rule']
export const DEFAULTS: Settings = { tools: true, spinner: true, prompts: true, footer: true, rule: true }

// replies stay rainbow on violet (reply-highlight); tools are gold; the person's prompts are teal
export const GOLD_HI = '#ffd86b'
export const GOLD_LO = '#c9962b'
export const GOLD = '#f5c542'
export const GOLD_TINT = '#221d12'
export const TEAL_TINT = '#12222a'
export const OK = '#30a46c'
export const ERR = '#e5484d'
export const VIOLET = '#b388ff'

// a hue in degrees to #rrggbb, bright enough for a dark panel (as reply-highlight's)
export function rainbow(hue: number): string {
  const s = 0.9
  const l = 0.68
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const c = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return `#${[0, 8, 4].map(n => c(n).toString(16).padStart(2, '0')).join('')}`
}

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

// the tool edge: light gold at the top to deep gold at the bottom
export function goldEdge(n: number): string[] {
  const [a, b] = [rgb(GOLD_HI), rgb(GOLD_LO)]
  return Array.from({ length: Math.max(1, n) }, (_, i) => {
    const t = n <= 1 ? 0 : i / (n - 1)
    return toHex(a.map((v, j) => v + (b[j]! - v) * t))
  })
}

const KIND: Record<string, string> = {
  Write: '✎', Edit: '✎', MultiEdit: '✎', NotebookEdit: '✎',
  Read: '⌕', Glob: '⌕', Grep: '⌕',
  Bash: '❯', PowerShell: '❯',
  WebFetch: '◍', WebSearch: '◍',
  Agent: '✦', Task: '✦', Skill: '✦',
}

export const iconFor = (tool: string) => KIND[tool] ?? (tool.startsWith('mcp__') ? '⬡' : '•')

// mcp__<server>__<tool> as server·tool, the connector prefix dropped
export function toolLabel(tool: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1]!.replace(/^claude_ai_/, '')}·${m[2]}` : tool
}

const norm = (p: string) => p.replace(/\\/g, '/')

// a path inside the cwd, relative to it; any other path as given, forward slashes
export function relPath(path: string, cwd: string): string {
  const p = norm(path)
  const root = norm(cwd).replace(/\/+$/, '')
  return root && p.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? p.slice(root.length + 1) : p
}

export function truncate(s: string, n: number): string {
  const chars = [...s]
  return chars.length <= n ? s : `${chars.slice(0, Math.max(0, n - 1)).join('')}…`
}

// one dim line saying what the call is about
export function summarize(tool: string, input: unknown, cwd: string): string {
  if (input === null || typeof input !== 'object') return ''
  const i = input as Record<string, unknown>
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined)
  const file = str('file_path') ?? str('notebook_path')
  if (file) return relPath(file, cwd)
  const command = str('command')
  if (command) return command.split('\n')[0]!.trim()
  if (tool === 'Grep' && str('pattern')) return `"${str('pattern')}"${str('path') ? ` in ${relPath(str('path')!, cwd)}` : ''}`
  return str('pattern') ?? str('url') ?? str('query') ?? str('description') ?? str('skill') ?? ''
}

export function groupLine(calls: ReadonlyArray<{ tool: string }>): string {
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  return [...counts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(' · ')
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function fmtClock(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export const BAR = 10
const FRAME_MS = 80
const LIT = 4
const DIM_RGB = 0x4a4458
const DEFAULT_BG = 0x01000000

// which cells are lit at time t: a run of LIT cells entering at the left and leaving at the right
const lit = (t: number) => {
  const head = Math.floor(t / FRAME_MS) % (BAR + LIT)
  return (i: number) => head - i >= 0 && head - i < LIT
}

export const barGlyphs = (t: number) => Array.from({ length: BAR }, (_, i) => (lit(t)(i) ? '▰' : '▱')).join('')

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// the cells are a multiple of 12 bytes, so there is never padding (as plan-progress-fx)
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  return out
}

// one frame of the bar as a Raster's cells: lit cells take the rainbow at their place
export function barCells(t: number): string {
  const on = lit(t)
  const words = new Uint32Array(BAR * 3)
  for (let i = 0; i < BAR; i++) {
    words[i * 3] = on(i) ? 0x25b0 : 0x25b1
    words[i * 3 + 1] = on(i) ? parseInt(rainbow((i / (BAR - 1)) * 300).slice(1), 16) : DIM_RGB
    words[i * 3 + 2] = DEFAULT_BG
  }
  return base64(new Uint8Array(words.buffer))
}

export function parseFx(args: string): { kind: 'show' } | { kind: 'set'; part: Part; on: boolean } | { kind: 'error' } {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: 'show' }
  const [part, value] = words
  if (words.length !== 2 || !PARTS.includes(part as Part) || (value !== 'on' && value !== 'off')) return { kind: 'error' }
  return { kind: 'set', part: part as Part, on: value === 'on' }
}

const settings = atom({ plugin: 'transcript-fx', key: 'settings' } as const, DEFAULTS)
// when the last main-loop turn ended and how long it ran; written at turn.complete, since drawing may not write state
const lastEnd = atom({ plugin: 'transcript-fx', key: 'lastEnd' } as const, null as { at: number; durationMs: number } | null)
// a footer is that turn's when it is first drawn soon after and its duration matches; any other shows no time
const FRESH_MS = 10_000
const SAME_TURN_MS = 2_000
const USAGE = `Usage: /fx [${PARTS.join('|')}] [on|off]`

const isOn = async ($: EngineInterface, part: Part) => (await read($, settings))[part]

// how many slices an edge gets: the layout shares the block's real height among them
export const edgeSegments = (text: string, columns: number) => {
  const width = Math.max(10, columns - 6)
  const rows = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / width)), 0) + 2
  return Math.min(48, Math.max(6, rows))
}

// a 1-column edge laid over the row's first (or last) column, so it never adds height
function edge(Box: any, colors: string[], side: 'left' | 'right') {
  return (
    <Box position="absolute" top={0} bottom={0} {...(side === 'left' ? { left: 0 } : { right: 0 })} width={1} flexDirection="column" overflow="hidden">
      {colors.map((c, i) => (
        <Box key={`edge-${i}`} flexGrow={1} backgroundColor={c} />
      ))}
    </Box>
  )
}

const status = (p: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }) =>
  p.isInterrupted
    ? { glyph: '⊘', color: undefined, dim: true }
    : p.isErrored
      ? { glyph: '✗', color: ERR, dim: false }
      : p.isRunning
        ? { glyph: '◐', color: GOLD, dim: false }
        : { glyph: '✓', color: OK, dim: false }

export const register: Register = on => {
  // each footer's end time, null for one that is not the last turn's; a reload starts it over
  const footerAt = new Map<string, number | null>()
  // spinners on screen, repainted in place each frame without a render pass
  const spinners = new Set<string>()
  // tool calls drawn as rows of an expanded group, which show their results inline
  const inExpandedGroup = new Set<string>()

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, lastEnd, () => ({ at: now, durationMs: e.durationMs }))
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    $.clock.every(FRAME_MS, async () => {
      if (spinners.size === 0) return
      const cells = barCells(await $.clock.now())
      // a spinner that is gone answers { deny } and leaves the set; its next drawing adds it back
      for (const requestId of spinners)
        void $.ui
          .blit({ requestId, key: 'bar', cells })
          .then(r => {
            if (r.deny !== undefined) spinners.delete(requestId)
          })
          .catch(() => spinners.delete(requestId))
    })
    try {
      const saved = await $.store.get('settings')
      if (saved && typeof saved === 'object') await update($, settings, () => ({ ...DEFAULTS, ...(saved as Partial<Settings>) }))
      await $.command.register({ name: 'fx', description: 'Show or toggle transcript-fx parts' })
    } catch {
      // the defaults stand; the session goes on
    }
    return next(e)
  })

  on('command.run', { command: 'fx' }, async ($, e) => {
    const cmd = parseFx(e.args)
    if (cmd.kind === 'error') return { text: USAGE }
    if (cmd.kind === 'set') {
      const now = { ...(await read($, settings)), [cmd.part]: cmd.on }
      await update($, settings, () => now)
      await $.store.set('settings', now)
      return { text: `transcript-fx: ${cmd.part} ${cmd.on ? 'on' : 'off'}.` }
    }
    const s = await read($, settings)
    return { text: PARTS.map(p => `${p}: ${s[p] ? 'on' : 'off'}`).join(' · ') }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // a row of an expanded group draws its result inline: the engine's row keeps it
    if (e.surface !== 'terminal' || inExpandedGroup.has(e.props.tool_use_id) || !(await isOn($, 'tools'))) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      const label = toolLabel(e.props.tool)
      const room = (e.viewport?.columns ?? 100) - label.length - 10
      // an unknown cwd only costs the relative paths, never the row
      const cwd = await $.session.cwd().catch(() => '')
      const summary = truncate(summarize(e.props.tool, e.props.input, cwd), room)
      const s = status(e.props)
      return (
        <Box flexDirection="row">
          {edge(Box, goldEdge(2), 'left')}
          <Box width={1} flexShrink={0} />
          <Box flexGrow={1} flexDirection="row" gap={1} paddingX={1}>
            <Text color={GOLD}>{iconFor(e.props.tool)}</Text>
            {/* the viewport is the window's width, not the transcript column's: the layout clips at the real one */}
            <Text bold color={GOLD} wrap="truncate-end">
              {label}
            </Text>
            <Box flexGrow={1}>
              <Text dimColor wrap="truncate-end">
                {summary}
              </Text>
            </Box>
            <Text color={s.color} dimColor={s.dim}>
              {s.glyph}
            </Text>
          </Box>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'tools'))) return next(e)
    // drawn once, so a failure below hands back this tree rather than calling next again
    const drawn = await next(e)
    try {
      const { Box } = $.ui.resolve(e)
      const text = typeof e.props.output === 'string' ? e.props.output : JSON.stringify(e.props.output ?? '')
      return (
        <Box flexDirection="row">
          {edge(Box, goldEdge(edgeSegments(text, e.viewport?.columns ?? 100)), 'left')}
          <Box width={1} flexShrink={0} />
          <Box flexGrow={1} flexDirection="column" backgroundColor={GOLD_TINT} paddingX={1}>
            {drawn}
          </Box>
        </Box>
      )
    } catch {
      return drawn
    }
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) for (const c of e.props.calls) if (c.tool_use_id !== undefined) inExpandedGroup.add(c.tool_use_id)
    if (e.surface !== 'terminal' || e.props.isExpanded || !(await isOn($, 'tools'))) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      const first = e.props.calls[0]?.tool ?? ''
      return (
        <Box flexDirection="row">
          {edge(Box, goldEdge(2), 'left')}
          <Box width={1} flexShrink={0} />
          <Box flexGrow={1} flexDirection="row" gap={1} paddingX={1}>
            <Text color={GOLD}>{iconFor(first)}</Text>
            <Box flexGrow={1}>
              <Text color={GOLD}>{groupLine(e.props.calls)}</Text>
            </Box>
            {e.props.isActive ? <Text color={GOLD}>◐</Text> : null}
          </Box>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // the person typing, at the terminal or through Remote Control; every other sender keeps its row
    const mine = e.props.origin.kind === 'composer' || e.props.origin.kind === 'bridge'
    if (e.surface !== 'terminal' || !mine || !(await isOn($, 'prompts'))) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      const n = edgeSegments(e.props.text, e.viewport?.columns ?? 100)
      // violet at the top to red at the bottom, mirroring the replies' edge
      const colors = Array.from({ length: n }, (_, i) => rainbow(300 - (i / Math.max(1, n - 1)) * 300))
      return (
        <Box flexDirection="row">
          <Box key="panel" flexGrow={1} flexDirection="row" backgroundColor={TEAL_TINT} paddingX={1} gap={1}>
            <Box flexGrow={1}>
              <Text>{e.props.text}</Text>
            </Box>
            <Text dimColor>you</Text>
          </Box>
          <Box width={1} flexShrink={0} />
          {edge(Box, colors, 'right')}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'spinner'))) return next(e)
    // the engine's line keeps the time and tokens no prop carries
    const drawn = await next(e)
    try {
      const { Box, Raster } = $.ui.resolve(e)
      spinners.add(e.requestId)
      return (
        <Box flexDirection="row" gap={1}>
          <Raster key="bar" columns={BAR} rows={1} cells={barCells(await $.clock.now())} />
          {drawn}
        </Box>
      )
    } catch {
      return drawn
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    // free only when core draws its own band and no survey is up; another plugin's band (pokecli's battle) stays
    const isFree = (drawn as { type?: string }).type === 'engine' && !e.props.hasSurvey
    if (e.surface !== 'terminal' || !isFree || !(await isOn($, 'rule'))) return drawn
    try {
      const { Box, Text } = $.ui.resolve(e)
      // the band's body, which a docked pane narrows below the window's width
      const width = Math.max(1, e.props.bodyColumns || e.viewport?.columns || 80)
      return (
        <Box key="rule" flexDirection="row">
          {Array.from({ length: width }, (_, i) => (
            <Text key={`r-${i}`} color={rainbow((i / Math.max(1, width - 1)) * 300)}>
              ─
            </Text>
          ))}
        </Box>
      )
    } catch {
      return drawn
    }
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'footer'))) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      // the first drawing decides once: the last turn's end time, or none, so a later turn never restamps it
      if (!footerAt.has(e.requestId)) {
        const end = await read($, lastEnd)
        const isThisTurn =
          end !== null && (await $.clock.now()) - end.at < FRESH_MS && Math.abs(end.durationMs - e.props.durationMs) < SAME_TURN_MS
        footerAt.set(e.requestId, isThisTurn ? end.at : null)
      }
      const at = footerAt.get(e.requestId) ?? null
      const word = e.props.word.toLowerCase()
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={VIOLET}>✦</Text>
          <Text bold>
            {[...word].map((ch, i) => (
              <Text key={`w-${i}`} color={rainbow((i / Math.max(1, word.length)) * 300)}>
                {ch}
              </Text>
            ))}
          </Text>
          <Text dimColor>{`in ${fmtDuration(e.props.durationMs)}${at === null ? '' : ` · ${fmtClock(at)}`}`}</Text>
        </Box>
      )
    } catch {
      return next(e)
    }
  })
}
