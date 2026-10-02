import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Info, Limit } from '../types'

const limits = atom({ plugin: 'limit-bars', key: 'limits' } as const, [] as Limit[])
const info = atom({ plugin: 'limit-bars', key: 'info' } as const, null as Info | null)
// the main loop's effort as its last model request carried it; null for a model without effort
const effort = atom({ plugin: 'limit-bars', key: 'effort' } as const, null as string | null)

// one ring each, told apart by colour: context, session, weekly, Fable
export const RINGS: { key: string; stops: number[][]; hotAt: number }[] = [
  { key: 'context', stops: [[80, 250, 140], [255, 210, 60], [255, 70, 90]], hotAt: 80 },
  { key: 'session', stops: [[0, 229, 255], [124, 77, 255]], hotAt: 90 },
  { key: 'weekly', stops: [[255, 64, 160], [255, 170, 60]], hotAt: 90 },
  { key: 'fable', stops: [[60, 255, 170], [60, 140, 255]], hotAt: 90 },
]
const HOT = [255, 70, 70]
const TRACK = [58, 58, 66]
const WHITE = [255, 255, 255]
const DEFAULT_BG = 0x01000000
const FPS_MS = 50
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// which window feeds which limit ring: five_hour, seven_day, then the model's own weekly window
export function pick(list: Limit[]): (Limit | undefined)[] {
  const model = list.find(l => /fable/i.test(l.kind)) ?? list.find(l => /^seven_day_/.test(l.kind))
  return [list.find(l => l.kind === 'five_hour'), list.find(l => l.kind === 'seven_day'), model]
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * t))
const pack = (c: number[]) => ((c[0]! & 255) << 16) | ((c[1]! & 255) << 8) | (c[2]! & 255)
const along = (stops: number[][], t: number) => {
  const k = Math.min(stops.length - 1.0001, Math.max(0, t) * (stops.length - 1))
  return mix(stops[Math.floor(k)]!, stops[Math.floor(k) + 1]!, k - Math.floor(k))
}
const hex = (c: number[]) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  return out
}

export function tokens(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

// the model without its family prefix, so the effort meter fits beside it: opus-5-5[1m]
export const shortModel = (model: string | undefined) => (model ? model.replace(/^claude-/, '') : '…')

export const folderOf = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

// a braille ring, RING_COLS x RING_ROWS cells (2x4 dots each), filled clockwise from 12 o'clock,
// the percentage drawn in the hole; a light orbits the filled arc
export const RING_COLS = 6
export const RING_ROWS = 3
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

export function ringCells(ring: number, pct: number | undefined, now: number): string {
  const { stops, hotAt } = RINGS[ring]!
  const W = RING_COLS
  const H = RING_ROWS
  const words = new Uint32Array(W * H * 3)
  const cx = W - 0.5 // dot-space centre: (2W - 1) / 2
  const cy = H * 2 - 0.5
  const r = Math.min(cx, cy) - 0.2
  const share = Math.max(0, Math.min(1, (pct ?? 0) / 100))
  const heat = pct !== undefined && pct >= hotAt ? 0.4 + 0.3 * Math.sin(now / 180) : 0
  // each ring's light starts at its own phase so they don't orbit in lockstep
  const orbit = ((now / 1600 + ring * 0.27) % 1) * share
  const label = pct === undefined ? ' -- ' : `${Math.round(pct)}%`.padStart(pct >= 100 ? 4 : 3).padEnd(4)
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      let on = 0
      let track = 0
      let angle = 0
      let lit = 0
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const x = col * 2 + dx - cx
          const y = row * 4 + dy - cy
          const d = Math.hypot(x, y)
          if (d < r - 1.3 || d > r + 0.45) continue
          const a = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1
          if (a <= share && share > 0) {
            on |= BRAILLE_BITS[dx]![dy]!
            angle = Math.max(angle, a)
            lit++
          } else {
            track |= BRAILLE_BITS[dx]![dy]!
          }
        }
      }
      const i = (row * W + col) * 3
      const inHole = row === Math.floor(H / 2) && col >= 1 && col <= W - 2
      if (inHole) {
        words[i] = label.codePointAt(col - 1) ?? 32
        words[i + 1] = pack(pct === undefined ? TRACK : mix(along(stops, share), HOT, heat))
      } else if (lit > 0) {
        const glow = Math.max(0, 1 - Math.abs(angle - orbit) * 8)
        words[i] = 0x2800 | on
        words[i + 1] = pack(mix(mix(along(stops, angle), HOT, heat), WHITE, glow * 0.75))
      } else {
        words[i] = 0x2800 | track
        words[i + 1] = pack(TRACK)
      }
      words[i + 2] = DEFAULT_BG
    }
  }
  return base64(new Uint8Array(words.buffer))
}

// the pie glyph nearest the share, where no Raster draws
export const pie = (pct: number | undefined) => '○◔◑◕●'[Math.round(Math.max(0, Math.min(1, (pct ?? 0) / 100)) * 4)]!

// plan-progress-fx draws its bars as a Box keyed 'pp-bars' (beside this status) or 'pp-solo' (in its place,
// on a screen too narrow for both); STATUS_W must match its copy there
export const STATUS_KEY = 'lb-status'
export const STATUS_W = 66
type El = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && !Array.isArray(n) && 'type' in n

// the tree without the first element whose key is one of `keys`, and that element
export function pluck(node: unknown, keys: string[]): [unknown, El | null] {
  if (Array.isArray(node)) {
    let found: El | null = null
    const out: unknown[] = []
    for (const n of node) {
      if (found) {
        out.push(n)
        continue
      }
      const [m, f] = pluck(n, keys)
      found = f
      if (m !== undefined) out.push(m)
    }
    return [out, found]
  }
  if (!isEl(node)) return [node, null]
  if (keys.includes(String(node.props?.key))) return [undefined, node]
  if (!node.children) return [node, null]
  const [children, found] = pluck(node.children, keys)
  return [found ? { ...node, children } : node, found]
}

// effort as its label alone, coloured along the model's violet-to-pink gradient by level;
// a numeric budget draws as its number
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_STOPS = [[124, 77, 255], [179, 136, 255], [255, 95, 210]]
export function effortBadge(level: string | null): { label: string; color: string } | null {
  if (level === null) return null
  const i = EFFORT_LEVELS.indexOf(level)
  return { label: level, color: hex(along(EFFORT_STOPS, i < 0 ? 0.5 : i / (EFFORT_LEVELS.length - 1))) }
}

// what the line last drew, so the frame clock can repaint the rings between renders
let mounted: { requestId: string; pcts: (number | undefined)[] } | null = null

async function measureInfo($: EngineInterface, context: { percent?: number; tokens?: number; window: number }) {
  const [model, root] = await Promise.all([$.session.model(), $.session.root()])
  await update($, info, () => ({ model, folder: folderOf(root), percent: context.percent, tokens: context.tokens, window: context.window }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits)
    await measureInfo($, usage.context)
    $.clock.every(FPS_MS, async () => {
      if (!mounted) return
      const now = await $.clock.now()
      const { requestId, pcts } = mounted
      pcts.forEach((p, i) => {
        void $.ui.blit({ requestId, key: `ring-${i}`, cells: ringCells(i, p, now) }).catch(() => undefined)
      })
    })
    return ran
  })

  // the effort rides on each model request of the main loop: note it, change nothing
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const level = e.effort === undefined ? null : String(e.effort)
      if ((await read($, effort)) !== level) await update($, effort, () => level)
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits)
    await measureInfo($, e.context)
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    const meta = await read($, info)
    const badge = effortBadge(await read($, effort))
    const pcts = [meta?.percent, ...pick(await read($, limits)).map(l => l?.percentUsed)]
    const now = await $.clock.now()
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    const Raster = e.surface === 'terminal' && 'Raster' in t ? t.Raster : null
    mounted = Raster ? { requestId: e.requestId, pcts } : null

    const rings = pcts.map((p, i) => {
      if (Raster) return <Raster key={`ring-${i}`} columns={RING_COLS} rows={RING_ROWS} cells={ringCells(i, p, now)} />
      const { stops, hotAt } = RINGS[i]!
      const color = p !== undefined && p >= hotAt ? HOT : along(stops, (p ?? 0) / 100)
      return <Text key={`ring-${i}`} color={hex(color)}>{`${pie(p)} ${p === undefined ? '—' : `${Math.round(p)}%`}`}</Text>
    })

    const status = (
      <Box key={STATUS_KEY} flexDirection="row" gap={2} width={STATUS_W} flexShrink={0}>
        {rings}
        <Box flexDirection="column" flexShrink={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold wrap="truncate" color="#b388ff">◆ {shortModel(meta?.model)}</Text>
            {badge ? (
              <Box flexShrink={0}>
                <Text italic color={badge.color}>
                  {badge.label}
                </Text>
              </Box>
            ) : null}
          </Box>
          <Text bold wrap="truncate" color="#4dd0e1">▸ {meta?.folder ?? '…'}</Text>
          <Text dimColor>{`${tokens(meta?.tokens)} / ${tokens(meta?.window)}`}</Text>
        </Box>
      </Box>
    )
    // progress bars drawn beneath us move beside the status, or take its place when alone
    const [rest, bars] = pluck(engine, ['pp-bars', 'pp-solo'])
    const solo = bars?.props?.key === 'pp-solo'
    if (solo) mounted = null
    return (
      <Box flexDirection="column">
        {rest as RenderElement}
        {solo ? (
          (bars as RenderElement)
        ) : bars ? (
          <Box flexDirection="row" gap={2}>
            {status}
            {bars as RenderElement}
          </Box>
        ) : (
          status
        )}
      </Box>
    )
  })
}
