import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { AgentRun, Plan, PlanStage, PlanState, PlanStep, StepStatus } from '../types'

const TOOL = 'mcp__plan-progress-fx__plan_progress'
const plans = atom({ plugin: 'plan-progress-fx', key: 'plans' } as const, [])
const MAX_BARS = 3
// a space as wide as a digit, so '  0%' and '100%' take the same room
const FIGURE_SPACE = String.fromCharCode(0x2007)
const isOpen = atom({ plugin: 'plan-progress-fx', key: 'isOpen' } as const, true)
const narrowOpen = atom({ plugin: 'plan-progress-fx', key: 'narrowOpen' } as const, false)
const tick = atom({ plugin: 'plan-progress-fx', key: 'tick' } as const, 0)
const STRIP_H = 18
const STRIP_GAP = 3
const MAX_STRIPS = 4 // past this, the finished ones fold into one "+N more" strip
const FOLD_MS = 5000 // finished strips stay this long, failed ones stay until the bar closes

const STATE_COLOR: Record<PlanState, string> = { running: '#8B7CF6', needs_input: '#E09A1E', error: '#E5484D', done: '#30A46C' }
const STATE_GLYPH: Record<PlanState, string> = { running: '●', needs_input: '?', error: '!', done: '✓' }
// the hue range a bar's title runs through, by state
const TITLE_HUES: Record<PlanState, [number, number]> = { running: [190, 300], needs_input: [30, 55], error: [350, 15], done: [120, 175] }
const toHex = (c: number[]) => `#${c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
const STATUSES: StepStatus[] = ['pending', 'active', 'done', 'error', 'skipped']
const TRACK_H = 22
const NARROW = 360

const RULES = `# Progress bars
Tasks needing more than ~3 edits or commands get a bar via ${TOOL}: create it once with the full breakdown (2-7 stages with short steps, or kind "todo" for one flat list; titles of at most 4 words, in the user's language), then update it with short calls only: {id, next:true} when the active step is finished, or {id, done:[...], active:"..."}, {id, failed:"...", note}. Send state "needs_input" with a note before asking the user to decide. Never describe the bars to the user.`

type Raw = Record<string, unknown>
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const status = (v: unknown): StepStatus => (STATUSES.includes(v as StepStatus) ? (v as StepStatus) : 'pending')
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []) as Raw[]
const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// short updates: {next:true}, {done:[titles]}, {active:title}, {failed:title} against the stored plan
function applyOps(stages: PlanStage[], input: Raw): PlanStage[] {
  const next = stages.map(s => ({ ...s, steps: s.steps.map(st => ({ ...st })) }))
  const steps = next.flatMap(s => s.steps)
  const find = (title: string) => steps.find(st => same(st.title, title))
  if (input.next === true) {
    const at = steps.findIndex(st => st.status === 'active') >= 0 ? steps.findIndex(st => st.status === 'active') : steps.findIndex(st => !isFinished(st.status))
    const cur = steps[at]
    if (cur) cur.status = 'done'
    const following = steps.slice(at + 1).find(st => st.status === 'pending')
    if (following) following.status = 'active'
  }
  for (const t of Array.isArray(input.done) ? input.done : []) {
    const st = typeof t === 'string' ? find(t) : undefined
    if (st) st.status = 'done'
  }
  const active = typeof input.active === 'string' ? find(input.active) : undefined
  if (active) {
    const at = steps.indexOf(active)
    steps.forEach((st, i) => {
      if (st.status === 'active' && i !== at) st.status = i < at ? 'done' : 'pending'
    })
    active.status = 'active'
  }
  const failed = typeof input.failed === 'string' ? find(input.failed) : undefined
  if (failed) failed.status = 'error'

  return next
}

function normalize(input: Raw, prev: Plan | null, now: number, id: string): Plan {
  const isPartial = list(input.stages).length === 0 && prev !== null
  const stages: PlanStage[] = isPartial ? applyOps(prev.stages, input) : list(input.stages)
    .map(s => ({
      name: str(s.name, 80) || 'Stage',
      steps: list(s.steps).map(st => ({
        title: str(st.title) || 'Step',
        status: status(st.status),
        substeps: list(st.substeps).map(sub => ({ title: str(sub.title) || '…', status: status(sub.status) })),
      })),
    }))
    .filter(s => s.steps.length > 0) as PlanStage[]
  const title = str(input.title, 80) || prev?.title || 'Plan'
  const steps = stages.flatMap(s => s.steps)
  const isAllDone = steps.length > 0 && steps.every(s => isFinished(s.status))
  const asked = input.state as PlanState
  const failedNow = typeof input.failed === 'string'
  const state: PlanState = ['running', 'needs_input', 'error', 'done'].includes(asked) ? asked : isAllDone ? 'done' : failedNow ? 'error' : 'running'

  return {
    id,
    title,
    kind: input.kind === 'todo' || (isPartial && prev?.kind === 'todo') ? 'todo' : 'plan',
    stages,
    state,
    note: str(input.note, 160) || null,
    startedAt: prev && prev.title === title ? prev.startedAt : now,
  }
}

const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(\d+[.)]|[-*+]|\[[ xX]\])\s+/, '')
    .replace(/^(\d+[.)]|\[[ xX]\])\s+/, '')
    .trim()

function parsePlan(markdown: string, now: number): Plan | null {
  let title = ''
  const headed: PlanStage[] = []
  const items: { depth: number; text: string }[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const text = clean(h[2] ?? '')
      if (h[1] === '#' && !title) title = text
      else headed.push({ name: text, steps: [] })
      continue
    }
    const li = line.match(/^(\s*)(\d+[.)]|[-*+])\s+(.*)$/)
    if (!li) continue
    const depth = Math.floor((li[1] ?? '').replace(/\t/g, '  ').length / 2)
    const text = clean(li[3] ?? '').slice(0, 120)
    if (!text) continue
    items.push({ depth, text })
    const stage = headed[headed.length - 1]
    if (!stage) continue
    const step = stage.steps[stage.steps.length - 1]
    if (depth === 0 || !step) stage.steps.push({ title: text, status: 'pending', substeps: [] })
    else step.substeps.push({ title: text, status: 'pending' })
  }
  let stages = headed.filter(s => s.steps.length > 0)
  if (stages.length === 0) {
    if (items.some(i => i.depth > 0)) {
      for (const item of items) {
        const stage = stages[stages.length - 1]
        if (item.depth === 0 || !stage) stages.push({ name: item.text, steps: [] })
        else stage.steps.push({ title: item.text, status: 'pending', substeps: [] })
      }
      stages = stages.map(s => (s.steps.length ? s : { ...s, steps: [{ title: s.name, status: 'pending', substeps: [] }] }))
    } else if (items.length > 0) {
      stages = [{ name: 'Tasks', steps: items.map(i => ({ title: i.text, status: 'pending' as StepStatus, substeps: [] })) }]
    }
  }
  if (stages.length === 0) return null
  const first = stages[0]?.steps[0]
  if (first) first.status = 'active'

  return { id: 'plan', title: title || 'Plan', kind: stages.length === 1 ? 'todo' : 'plan', stages, state: 'running', note: null, startedAt: now }
}

function st(title: string, s: StepStatus): PlanStep {
  return { title, status: s, substeps: [] }
}

const DEMO = (now: number): Plan => ({
  id: 'demo',
  title: 'Orders module',
  kind: 'plan',
  state: 'running',
  note: null,
  startedAt: now - 260_000,
  stages: [
    { name: 'Analysis', steps: [st('Read modules', 'done'), st('Find dependencies', 'done'), st('List changes', 'done')] },
    { name: 'DB migration', steps: [st('Table schema', 'done'), st('Create migration', 'done'), st('Move data', 'active'), st('Indexes', 'pending')] },
    { name: 'API', steps: [st('Endpoints', 'pending'), st('Validation', 'pending'), st('Access rules', 'pending')] },
    { name: 'Interface', steps: [st('List page', 'pending'), st('Order card', 'pending'), st('Filters', 'pending'), st('Empty states', 'pending')] },
    { name: 'Verify', steps: [st('Tests', 'pending'), st('Build', 'pending')] },
  ],
})

// ---------- drawing ----------

type Where = { pos: number; total: number; stage: number; step: number; stageSize: number }

function where(p: Plan): Where {
  const steps = p.stages.flatMap((s, i) => s.steps.map((step, j) => ({ i, j, step })))
  const at = steps.findIndex(x => !isFinished(x.step.status))
  const pos = p.state === 'done' || at < 0 ? steps.length : at
  const cur = steps[Math.min(pos, steps.length - 1)]
  const stage = cur?.i ?? 0

  return { pos, total: steps.length, stage, step: pos >= steps.length ? (p.stages[stage]?.steps.length ?? 0) : (cur?.j ?? 0) + 1, stageSize: p.stages[stage]?.steps.length ?? 0 }
}

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (a: number[], b: number[], m: number) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m))
const rgb = (c: number[]) => `rgb(${c.join(',')})`
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const hash = (a: number, b: number, k: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const textWidth = (s: string, px = 6.7) => [...s].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 12 : /[ilI.,:;'|!]/.test(ch) ? 3.4 : /[mwMWШЩЖМ]/.test(ch) ? 9.5 : px), 0)

const ICON_PATH: Partial<Record<PlanState, string>> = {
  needs_input: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  error: 'M18 6 6 18M6 6l12 12',
  done: 'M20 6 9 17l-5-5',
}

// last drawn head position per plan, so a redraw glides from where the bar was
const lastHead = new Map<string, number>()

function trackSvg(p: Plan, W: number): string {
  const H = TRACK_H
  const w = where(p)
  const done = p.state === 'done'
  // the fill is exactly the finished share: a fresh plan starts empty
  const frac = done ? 1 : Math.min(1, w.pos / Math.max(1, w.total))
  const fx = frac * W
  const key = p.id
  const from = lastHead.get(key) ?? fx
  lastHead.set(key, fx)

  const acc = hex(STATE_COLOR[p.state])
  const light = mix(acc, [255, 255, 255], 0.32)
  const grey = [132, 130, 138]
  const ease = 'calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"'
  const glide = Math.abs(from - fx) > 0.5

  const bounds: number[] = []
  let acc2 = 0
  p.stages.forEach((s, i) => {
    acc2 += s.steps.length
    if (i < p.stages.length - 1) bounds.push((acc2 / w.total) * W)
  })

  // pixels: 3px grid, 7 rows, denser and closer to the state colour towards the head
  const buckets = [0, 1, 2, 3, 4].map(b => {
    const m = b / 4
    const dense = done ? 0.8 : 0.22 + 0.78 * Math.pow(m, 1.5)
    return { color: rgb(done ? light : mix(grey, light, m)), opacity: (0.35 + 0.65 * dense).toFixed(2) }
  })
  let px = ''
  for (let col = 0; col * 3 < fx; col++) {
    const x = col * 3
    const u = Math.min(1, (x + 1.5) / fx)
    const dense = done ? 0.8 : 0.22 + 0.78 * Math.pow(u, 1.5)
    const bucket = done ? 4 : Math.min(4, Math.floor(Math.min(1, Math.pow(u, 0.9) * 1.1) * 4.99))
    for (let r = 0; r < 7; r++) {
      if (hash(col, r, 1) > dense + 0.1) continue
      px += `<rect x="${x}" y="${1 + r * 3}" class="b${bucket} t${Math.floor(hash(col, r, 2) * 4)}"/>`
    }
  }

  let marks = ''
  let k = 0
  p.stages.forEach((s, i) => {
    s.steps.forEach((_, j) => {
      if (k > 0) {
        const x = (k / w.total) * W
        const isStage = j === 0
        // stage boundaries are full-height lines, steps are short ticks; bright once passed
        const passed = x < fx - 1
        const h = isStage ? H : 8
        const fill = passed ? rgb(mix(light, [255, 255, 255], 0.45)) : '#8A8984'
        const opacity = passed ? (isStage ? 0.95 : 0.6) : isStage ? 0.7 : 0.45
        marks += `<rect x="${(x - (isStage ? 1 : 0.75)).toFixed(1)}" y="${(H - h) / 2}" width="${isStage ? 2 : 1.5}" height="${h}" rx=".75" fill="${fill}" opacity="${opacity}"/>`
      }
      k++
    })
    void i
  })

  // knob: a pill with stage and count, or a round dot with the stage number when narrow
  const isNarrow = W < NARROW
  const color = STATE_COLOR[p.state]
  const icon = ICON_PATH[p.state]
  const single = p.stages.length === 1
  const number = single ? Math.min(w.total, w.pos + 1) : w.stage + 1
  let knob = ''
  let kw = H
  if (isNarrow) {
    const label = done ? '' : String(number)
    knob = `<circle cx="0" cy="${H / 2}" r="${H / 2}" fill="${color}"/>${
      done ? `<path d="${ICON_PATH.done}" transform="translate(-6 5) scale(.5)" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : `<text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${label}</text>`
    }`
  } else {
    const name = done ? 'Done' : single ? (p.stages[0]?.name ?? 'Tasks') : (p.stages[w.stage]?.name ?? '')
    const agents = p.agents ?? []
    const base = p.id === AGENTS ? `${w.pos}/${w.total}` : done ? `${w.total}/${w.total}` : single ? `${number}/${w.total}` : `${w.step}/${w.stageSize}`
    const agentCount = agents.length > 0 && p.id !== AGENTS ? ` · ${agents.filter(a => a.state === 'done').length}/${agents.length} agents` : ''
    const count = base + agentCount
    const iconW = icon ? 16 : 0
    const countW = textWidth(count, 6.5)
    const maxW = Math.max(80, W * 0.55)
    let shown = name
    while (shown.length > 3 && 20 + iconW + textWidth(shown) + 6 + countW > maxW) shown = shown.slice(0, -1)
    if (shown !== name) shown = shown.trimEnd() + '…'
    kw = Math.round(20 + iconW + textWidth(shown) + 6 + countW)
    const left = -kw / 2 + 10
    knob = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>`
    if (icon) knob += `<path d="${icon}" transform="translate(${left} 5) scale(.5)" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`
    knob += `<text x="${left + iconW}" y="${H / 2 + 4.2}" class="kt">${esc(shown)}<tspan class="kc" dx="6">${count}</tspan></text>`
  }
  const clampX = (x: number) => Math.max(kw / 2, Math.min(W - kw / 2, x))
  const kx = clampX(fx)
  const kFrom = clampX(from)

  const style = `<style>
.b0{fill:${buckets[0]?.color};fill-opacity:${buckets[0]?.opacity}}.b1{fill:${buckets[1]?.color};fill-opacity:${buckets[1]?.opacity}}
.b2{fill:${buckets[2]?.color};fill-opacity:${buckets[2]?.opacity}}.b3{fill:${buckets[3]?.color};fill-opacity:${buckets[3]?.opacity}}
.b4{fill:${buckets[4]?.color};fill-opacity:${buckets[4]?.opacity}}
rect[class]{width:2px;height:2px}
.t0,.t1,.t2,.t3{animation:tw ${done ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${done ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${done ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${done ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${done ? 0.8 : 0.45}}}
.kt{font:500 12px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:#fff}
.kc{font-weight:400;fill-opacity:.75}
@media (prefers-reduced-motion:reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>`
  const glideFill = glide ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur=".45s" ${ease} fill="freeze"/>` : ''
  const glideKnob = glide ? `<animateTransform attributeName="transform" type="translate" from="${kFrom.toFixed(1)} 0" to="${kx.toFixed(1)} 0" dur=".45s" ${ease} fill="freeze"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style}
<defs><clipPath id="pill"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill"><rect width="${fx.toFixed(1)}" height="${H}">${glideFill}</rect></clipPath>
<linearGradient id="base" x1="0" x2="${fx.toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity="${done ? 0.3 : 0.05}"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity=".33"/></linearGradient></defs>
<g clip-path="url(#pill)"><rect width="${W}" height="${H}" fill="#808080" fill-opacity=".16"/>
<g clip-path="url(#fill)"><rect width="${fx.toFixed(1)}" height="${H}" fill="url(#base)"/>${px}</g>${marks}</g>
<g transform="translate(${kx.toFixed(1)} 0)">${glideKnob}${knob}</g></svg>`
}

const AGENT_COLOR: Record<AgentRun['state'], string> = {
  running: STATE_COLOR.running,
  waiting: STATE_COLOR.needs_input,
  done: STATE_COLOR.done,
  error: STATE_COLOR.error,
}

const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000))
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

// which strips show: all of a small batch; in a big one the unfinished first, the rest folded into one line
function visibleAgents(p: Plan, now: number): { shown: AgentRun[]; hidden: AgentRun[] } | null {
  const list = p.agents ?? []
  if (list.length === 0) return null
  const hasError = list.some(a => a.state === 'error')
  if (p.agentsDoneAt && now - p.agentsDoneAt > FOLD_MS && !hasError) return null
  if (list.length <= MAX_STRIPS) return { shown: list, hidden: [] }
  const keep = new Set(list.filter(a => a.state !== 'done').slice(0, MAX_STRIPS - 1).map(a => a.id))
  for (const a of [...list].reverse()) {
    if (keep.size >= MAX_STRIPS - 1) break
    keep.add(a.id)
  }
  return { shown: list.filter(a => keep.has(a.id)), hidden: list.filter(a => !keep.has(a.id)) }
}

// what each strip showed last time it was drawn, so a change morphs from the old status instead of jumping
const lastStrip = new Map<string, { tool: string; color: string }>()
const MORPH = '.2s'

const stripsHeight = (n: number) => n * STRIP_H + (n - 1) * STRIP_GAP

// one tinted strip per agent: state colour, name, what it does now and for how long; not a progress bar
function stripsSvg(v: { shown: AgentRun[]; hidden: AgentRun[] }, W: number, now: number): string {
  const isNarrow = W < NARROW
  const rows: string[] = []
  v.shown.forEach((a, i) => {
    const c = AGENT_COLOR[a.state]
    const y = i * (STRIP_H + STRIP_GAP)
    const indent = a.depth > 0 ? 12 : 0
    let px = ''
    if (a.state === 'running') {
      for (let col = 0; col * 3 < W; col++) {
        for (let r = 0; r < 4; r++) {
          if (hash(col + i * 41, r, 5) > 0.2) continue
          px += `<rect x="${col * 3}" y="${y + 3 + r * 3.6}" class="t${Math.floor(hash(col, r, 6) * 4)}" fill="${c}" fill-opacity=".32"/>`
        }
      }
    }
    const nameRoom = isNarrow ? W - 30 - indent : W * 0.5
    let name = (a.depth > 0 ? '↳ ' : '') + a.title
    while (name.length > 4 && textWidth(name, 6.2) > nameRoom) name = name.slice(0, -1)
    if (name !== (a.depth > 0 ? '↳ ' : '') + a.title) name = name.trimEnd() + '…'
    const nameX = 19 + indent
    const toolX = nameX + textWidth(name, 6.2) + 8
    const time = elapsed((a.endedAt ?? now) - a.startedAt)
    // a status change: the old word blurs out while the new one blurs in, and the tint flows to the new colour
    const was = lastStrip.get(a.id)
    lastStrip.set(a.id, { tool: a.tool, color: c })
    const isToolChanged = was !== undefined && was.tool !== a.tool
    const flow = (attr: string) => (was && was.color !== c ? `<animate attributeName="${attr}" from="${was.color}" to="${c}" dur="${MORPH}" fill="freeze"/>` : '')
    const tool = isNarrow
      ? ''
      : (isToolChanged ? `<text x="${toolX}" y="${y + 12.5}" class="sn mo" style="fill:${was.color}">${esc(was.tool)}</text>` : '') +
        `<text x="${toolX}" y="${y + 12.5}" class="sn${isToolChanged ? ' mi' : ''}" style="fill:${c}">${esc(a.tool)}</text>` +
        `<text x="${W - 9}" y="${y + 12.5}" text-anchor="end" class="sn st">${time}</text>`
    rows.push(
      `<rect x="0" y="${y}" width="${W}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="${c}" fill-opacity=".15">${flow('fill')}</rect>${px}` +
        `<circle cx="${10 + indent}" cy="${y + STRIP_H / 2}" r="3" fill="${c}"${a.state === 'running' ? ' class="sd"' : ''}>${flow('fill')}</circle>` +
        `<text x="${nameX}" y="${y + 12.5}" class="sn">${esc(name)}</text>` +
        tool,
    )
  })
  if (v.hidden.length > 0) {
    const y = v.shown.length * (STRIP_H + STRIP_GAP)
    const doneCount = v.hidden.filter(a => a.state === 'done').length
    rows.push(
      `<rect x="0" y="${y}" width="${W}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="#808080" fill-opacity=".14"/>` +
        `<text x="10" y="${y + 12.5}" class="sn st">+${plural(v.hidden.length, 'more agent')} · ${doneCount} done</text>`,
    )
  }
  return `<style>.sn{font:400 11.5px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:#F0EEFC}.st{fill-opacity:.65}
.sd{animation:sp 1.1s ease-in-out infinite}@keyframes sp{50%{opacity:.3}}
.mi{animation:mi ${MORPH} ease-out both}@keyframes mi{from{opacity:0;filter:blur(3px)}}
.mo{animation:mo ${MORPH} ease-in both}@keyframes mo{to{opacity:0;filter:blur(3px)}}
@media (prefers-reduced-motion:reduce){.sd,.mi,.mo{animation:none}.mo{opacity:0}}</style>${rows.join('')}`
}

// ---------- terminal: an animated pixel bar on a Raster, repainted by blit ----------
// each cell is '▀' with its own top (fg) and bottom (bg) colour, so one row reads as two rows of pixels

const FPS_MS = 33
const GLIDE_MS = 500
const BURST_MS = 1600
const SHIMMER_MS = 1700
const TRACK_RGB = [58, 56, 66]
const WHITE = [255, 255, 255]
const BLOCK_EIGHTHS = [0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589] // ▏ … ▉
const SPARKS = [0x2726, 0x2727, 0x22c6, 0x00b7, 0x002b] // ✦ ✧ ⋆ · +

// where each bar's fill was heading and since when, and when its state last changed
type Anim = { from: number; to: number; at: number; state: PlanState; stateAt: number }
const anims = new Map<string, Anim>()
// limit-bars draws its status under the prompt as a Box keyed STATUS_KEY, STATUS_W cells wide;
// the bars sit to its right when both fit, and alone in its place otherwise
const STATUS_KEY = 'lb-status'
const STATUS_W = 58
const MIN_TRACK = 24
type El = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && !Array.isArray(n) && 'type' in n

// the tree with the element keyed `key` swapped for what `swap` makes of it, and whether one was
function swapKeyed(node: unknown, key: string, swap: (el: El) => unknown): [unknown, boolean] {
  if (Array.isArray(node)) {
    let hit = false
    const out = node.map(n => {
      if (hit) return n
      const [m, h] = swapKeyed(n, key, swap)
      hit = h
      return m
    })
    return [out, hit]
  }
  if (!isEl(node)) return [node, false]
  if (node.props?.key === key) return [swap(node), true]
  if (!node.children) return [node, false]
  const [children, hit] = swapKeyed(node.children, key, swap)
  return [hit ? { ...node, children } : node, hit]
}

const titleWidth = (list: Plan[], cols: number) => Math.min(Math.round(cols * 0.3), Math.max(...list.map(p => p.title.length)))
// glyph, gaps, percent and the close button take ~16 cells
const isWide = (list: Plan[], cols: number) => cols - STATUS_W - 2 - titleWidth(list, cols - STATUS_W - 2) - 16 >= MIN_TRACK

// what the band last drew, so the frame clock can repaint it between renders
let band: { requestId: string; bars: { key: string; plan: Plan; cols: number }[] } | null = null

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3)
const pack = (c: number[]) => (((c[0] ?? 0) & 255) << 16) | (((c[1] ?? 0) & 255) << 8) | ((c[2] ?? 0) & 255)
// hue in degrees, saturation and lightness 0-1, to [r, g, b]
function hsl(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))))
}
const shade = (c: number[], m: number) => (m >= 0 ? mix(c, WHITE, Math.min(1, m)) : mix(c, [0, 0, 0], Math.min(1, -m)))

function fillShare(p: Plan): number {
  if (p.state === 'done') return 1
  const w = where(p)
  return Math.min(1, w.pos / Math.max(1, w.total))
}

const shareAt = (a: Anim, now: number) => a.from + (a.to - a.from) * easeOut((now - a.at) / GLIDE_MS)

// called while drawing: a new target glides from wherever the fill is now
function aim(p: Plan, now: number): Anim {
  const to = fillShare(p)
  const prev = anims.get(p.id)
  if (!prev) {
    const a = { from: to, to, at: now, state: p.state, stateAt: p.state === 'done' ? now - BURST_MS : now }
    anims.set(p.id, a)
    return a
  }
  if (Math.abs(prev.to - to) > 1e-6) {
    prev.from = shareAt(prev, now)
    prev.to = to
    prev.at = now
  }
  if (prev.state !== p.state) {
    prev.state = p.state
    prev.stateAt = now
  }
  return prev
}

// one width-1 glyph per character: wide and combining characters would shift every cell after them
function cellText(s: string): number[] {
  const out: number[] = []
  for (const ch of s.replace(/\p{M}/gu, '')) {
    const cp = ch.codePointAt(0) ?? 63
    const isWide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60)
    out.push(cp < 0x20 || cp > 0xffff || isWide ? 63 : cp)
  }
  return out
}

function knobLabel(p: Plan, W: number): number[] {
  const w = where(p)
  const single = p.stages.length === 1
  if (p.state === 'done') return cellText(` ✓ Done ${w.total}/${w.total} `)
  const glyph = p.state === 'needs_input' ? '? ' : p.state === 'error' ? '✕ ' : ''
  const name = single ? (p.stages[0]?.name ?? 'Tasks') : (p.stages[w.stage]?.name ?? '')
  const count = single ? `${Math.min(w.total, w.pos + 1)}/${w.total}` : `${w.step}/${w.stageSize}`
  const room = Math.max(4, Math.floor(W * 0.6) - count.length - glyph.length - 3)
  let shown = cellText(name)
  if (shown.length > room) shown = [...shown.slice(0, room - 1), 0x2026]
  return W < 24 ? cellText(` ${count} `) : [32, ...cellText(glyph), ...shown, 32, ...cellText(count), 32]
}

function rasterCells(p: Plan, W: number, now: number): string {
  const a = anims.get(p.id) ?? aim(p, now)
  const words = new Uint32Array(W * 3)
  const put = (x: number, cp: number, fg: number[], bg: number[]) => {
    words[x * 3] = cp
    words[x * 3 + 1] = pack(fg)
    words[x * 3 + 2] = pack(bg)
  }
  const acc = hex(STATE_COLOR[p.state])
  const light = mix(acc, WHITE, 0.35)
  const deep = mix(acc, TRACK_RGB, 0.6)
  const sinceState = now - a.stateAt
  const isRunning = p.state === 'running'
  const isDone = p.state === 'done'
  const isBursting = isDone && sinceState < BURST_MS
  const fx = shareAt(a, now) * W
  const full = Math.floor(fx)
  const part = fx - full

  // the whole fill breathes while waiting on the person; an error flashes for a second, then holds
  const breathe = p.state === 'needs_input' ? 0.18 * Math.sin(now / 420) : p.state === 'error' && sinceState < 1000 ? (Math.floor(sinceState / 160) % 2 ? 0.35 : -0.1) : 0
  // a soft highlight sweeps along the fill while it runs; on done one bright wave crosses the bar
  const sweep = isRunning ? ((now % SHIMMER_MS) / SHIMMER_MS) * (fx + 16) - 8 : isBursting ? (sinceState / 450) * (W + 10) - 5 : -99
  const sweepW = isRunning ? 5 : 3

  // stage boundaries, so the bar still reads as stages
  const w = where(p)
  const bounds = new Set<number>()
  let acc2 = 0
  p.stages.forEach((s, i) => {
    acc2 += s.steps.length
    if (i < p.stages.length - 1) bounds.add(Math.round((acc2 / Math.max(1, w.total)) * W))
  })

  // running and done bars are a rainbow flowing along the fill; waiting and error keep their own colour
  const isRainbow = isRunning || isDone
  const hueAt = (x: number) => ((x / Math.max(1, W)) * 320 + now / (isDone ? 14 : 9)) % 360

  const pixel = (x: number, row: number): number[] => {
    const u = clamp01((x + 0.5) / Math.max(1, fx))
    const n = hash(x, row, 3)
    // brighter towards the head, each pixel twinkling on its own clock
    const base = isRainbow
      ? hsl(hueAt(x + row * 0.5 + n * 3), 0.85, isDone ? 0.58 : 0.42 + 0.18 * Math.pow(u, 1.2) + 0.05 * n)
      : mix(deep, light, Math.pow(u, 1.3) * (0.75 + 0.25 * n))
    const tw = Math.sin(now / ((isDone ? 900 : 520) + n * 700) + n * 40) * (isDone ? 0.06 : 0.12)
    const glow = Math.max(0, 1 - Math.abs(x - sweep) / sweepW) * (isRunning ? 0.45 : 0.85)
    const head = isRunning && fx - x < 2.5 ? 0.18 + 0.15 * Math.sin(now / 160) : 0
    return shade(base, tw + glow + head + breathe)
  }

  for (let x = 0; x < W; x++) {
    if (x < full) {
      put(x, 0x2580, pixel(x, 0), pixel(x, 1))
    } else if (x === full && part > 0.06) {
      const i = Math.min(BLOCK_EIGHTHS.length - 1, Math.floor(part * BLOCK_EIGHTHS.length))
      put(x, BLOCK_EIGHTHS[i] ?? 0x258c, shade(isRainbow ? hsl(hueAt(x), 0.9, 0.6) : light, isRunning ? 0.25 + 0.2 * Math.sin(now / 160) : 0), TRACK_RGB)
    } else {
      // the empty track: faint dots, a brighter tick at each stage boundary
      const isBound = bounds.has(x)
      put(x, isBound ? 0x2502 : hash(x, 9, 4) > 0.82 ? 0x00b7 : 0x20, isBound ? [120, 118, 128] : [84, 82, 92], TRACK_RGB)
    }
  }

  // done: sparks pop over the bar for a moment
  if (isBursting) {
    const frame = Math.floor(now / 70)
    const fade = 1 - sinceState / BURST_MS
    for (let x = 0; x < W; x++) {
      if (hash(x, frame, 7) > 0.12 * fade + 0.02) continue
      const spark = SPARKS[Math.floor(hash(x, frame, 8) * SPARKS.length)] ?? 0x2726
      put(x, spark, hash(x, frame, 9) > 0.3 ? hsl(hash(x, frame, 10) * 360, 1, 0.72) : WHITE, pixel(x, 1))
    }
  }

  // the knob: stage and count on a pill riding the head
  const label = knobLabel(p, W)
  if (label.length <= W) {
    const start = Math.max(0, Math.min(W - label.length, Math.round(fx - label.length / 2)))
    // a rainbow bar's pill takes the hue beneath it, darkened so the white text stays readable
    const pill = isRainbow ? hsl(hueAt(fx), 0.75, 0.36) : shade(acc, breathe * 0.5)
    label.forEach((cp, i) => put(start + i, cp, WHITE, pill))
  }

  return base64(new Uint8Array(words.buffer))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// the cells are always a multiple of 12 bytes, so there is never padding to add
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  return out
}

// true while some bar still moves: a glide, a shimmer, a pulse or a burst
function isMoving(now: number): boolean {
  return (band?.bars ?? []).some(b => {
    const a = anims.get(b.plan.id)
    return b.plan.state !== 'done' || (a !== undefined && (now - a.at < GLIDE_MS || now - a.stateAt < BURST_MS))
  })
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ---------- engine glue ----------

// the engine's player first (afplay on macOS); PowerShell where it cannot play
function play($: EngineInterface, name: 'decision' | 'error' | 'done') {
  const file = `${$.plugin.root}/sounds/${name}.wav`.replace(/\//g, '\\')
  void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() =>
    $.process
      .run(['powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`], { timeoutMs: 5000 })
      .catch(() => undefined),
  )
}

// the agents bar is the mod's own; the model never owes it an update
const AGENTS = 'agents:auto' // slug() never yields ':', so no model id can take it
const isOpenPlan = (p: Plan) => p.id !== AGENTS && p.state === 'running' && !p.stages.flatMap(s => s.steps).every(s => isFinished(s.status))

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'plan'

// adds or replaces one bar by id; keeps at most MAX_BARS, dropping finished ones first
// computed inside update() from the latest list, so concurrent writers (parallel agents) do not drop each other
function placeBar(list: readonly Plan[], next: Plan): Plan[] {
  const prev = list.find(p => p.id === next.id)
  // an update keeps its row; a new bar goes to the bottom
  const rest = prev ? list.map(p => (p.id === next.id ? next : p)) : [...list, next]
  while (rest.length > MAX_BARS) {
    const doneAt = rest.findIndex(p => p.state === 'done')
    rest.splice(doneAt >= 0 ? doneAt : 0, 1)
  }
  return rest
}

function chime($: EngineInterface, prev: PlanState | undefined, next: PlanState) {
  if (next === prev) return
  if (next === 'needs_input') play($, 'decision')
  if (next === 'error') play($, 'error')
  if (next === 'done') play($, 'done')
}

async function putPlan($: EngineInterface, next: Plan) {
  let prev: Plan | undefined
  await update($, plans, list => {
    prev = list.find(p => p.id === next.id)
    return placeBar(list, next)
  })
  chime($, prev?.state, next.state)
  if (!prev) await update($, isOpen, () => true)
}

// ---------- agents: drawn from engine events alone, no model calls ----------
// each subagent lives on a bar as one state strip: the open task bar it was started under,
// the bar of its parent agent, or the mod's own "Agents" bar when no task is open.
// Module maps: a reload forgets running agents, whose strips then stay until the bar is closed.
const agentHome = new Map<string, string>() // agentId -> bar id
const toolUses = new Map<string, string>() // tool_use_id -> agentId, to find who waits on a permission
const waiting = new Set<string>()
let foldUntil = 0 // keep ticking until finished strips have folded

// the mod's own bar mirrors its agents as steps, finished first, so percent and count read done/total
function syncAuto(p: Plan, now: number): Plan {
  const agents = p.agents ?? []
  const isOver = agents.length > 0 && agents.every(a => a.state === 'done' || a.state === 'error')
  const agentsDoneAt = isOver ? (p.agentsDoneAt ?? now) : null
  if (p.id !== AGENTS) return { ...p, agentsDoneAt }
  const rank = (a: AgentRun) => (a.state === 'done' ? 0 : a.state === 'error' ? 1 : 2)
  const steps: PlanStep[] = [...agents]
    .sort((a, b) => rank(a) - rank(b))
    .map(a => ({ title: a.title, status: a.state === 'done' ? 'done' : a.state === 'error' ? 'error' : 'active', substeps: [] }))
  const state: PlanState = isOver
    ? agents.some(a => a.state === 'error') ? 'error' : 'done'
    : agents.some(a => a.state === 'waiting') ? 'needs_input' : 'running'
  return { ...p, agentsDoneAt, stages: [{ name: 'Agents', steps }], state }
}

function addRun(p: Plan, run: AgentRun, parentId: string | undefined, now: number): Plan {
  // a batch that has finished makes room for the next one
  const list = p.agentsDoneAt ? [] : [...(p.agents ?? [])]
  let at = list.length
  const parentAt = parentId ? list.findIndex(a => a.id === parentId) : -1
  if (parentAt >= 0) {
    at = parentAt + 1
    while (at < list.length && (list[at]?.depth ?? 0) > 0) at++
  }
  list.splice(at, 0, run)
  return syncAuto({ ...p, agents: list, agentsDoneAt: null }, now)
}

// changes one agent's strip inside the latest list; sounds follow the bar's state
async function editAgent($: EngineInterface, agentId: string, change: (a: AgentRun) => AgentRun) {
  const home = agentHome.get(agentId)
  if (!home) return
  const now = await $.clock.now()
  let before: PlanState | undefined
  let after: PlanState | undefined
  let isFolding = false
  await update($, plans, list =>
    list.map(p => {
      if (p.id !== home || !p.agents?.some(a => a.id === agentId)) return p
      before = p.state
      const next = syncAuto({ ...p, agents: p.agents.map(a => (a.id === agentId ? change(a) : a)) }, now)
      after = next.state
      isFolding = !p.agentsDoneAt && next.agentsDoneAt !== null
      return next
    }),
  )
  if (isFolding) foldUntil = now + FOLD_MS + 1500
  if (before !== undefined && after !== undefined) chime($, before, after)
}

async function dropPlan($: EngineInterface, id: string) {
  lastHead.delete(id)
  anims.delete(id)
  for (const p of await read($, plans)) if (p.id === id) for (const a of p.agents ?? []) lastStrip.delete(a.id)
  await update($, plans, list => list.filter(p => p.id !== id))
}

const STEP_SCHEMA = {
  type: 'object',
  required: ['title', 'status'],
  properties: {
    title: { type: 'string' },
    status: { enum: STATUSES },
    substeps: {
      type: 'array',
      items: { type: 'object', required: ['title', 'status'], properties: { title: { type: 'string' }, status: { enum: STATUSES } } },
    },
  },
}

// only calls that change something count as work for the enforcement below; reading and searching are free
const WORK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])
const WORK_BEFORE_PLAN = 3 // the 4th changing call without a plan is refused once
const CALLS_BEFORE_NUDGE = 6 // working calls without a plan update before a reminder


export const register: Register = on => {
  // per-turn bookkeeping; module variables are fine here, a reload just starts a fresh count
  let workCalls = 0
  let sinceUpdate = 0
  let isPlanTouched = false
  let hasRefused = false
  let isWaitingOnBackground = false

  on('turn.start', async ($, e, next) => {
    workCalls = 0
    sinceUpdate = 0
    isPlanTouched = false
    hasRefused = false
    isWaitingOnBackground = false

    return next(e)
  })

  // the rule lives in the cached system prompt; a message only carries one short line when bars are open,
  // and the person answering clears any "needs input" without a model call
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    const list = await read($, plans)
    if (list.some(p => p.state === 'needs_input')) {
      await update($, plans, all => all.map(p => (p.state === 'needs_input' ? { ...p, state: 'running' as const, note: null } : p)))
    }
    const open = list.filter(p => p.state !== 'done' && p.id !== AGENTS)
    if (open.length === 0) return next(e)
    const line = `plan-progress open bars: ${open
      .map(p => {
        const w = where(p)
        return `${p.id} (${p.stages[w.stage]?.name ?? ''} ${w.step}/${w.stageSize})`
      })
      .join(', ')}`

    return next({ ...e, context: [...(e.context ?? []), line] })
  })

  // watches the main loop's changing calls: refuses once when multi-step work starts without a bar,
  // and reminds to update the bar when it goes stale mid-turn
  on('tool.call', async ($, e, next) => {
    // a subagent's call only names its current tool on its strip; no gate, no reminders
    if (e.agentId) {
      const agentId = e.agentId
      if (!agentHome.has(agentId)) return next(e)
      await editAgent($, agentId, a => ({ ...a, state: 'running', tool: e.tool }))
      if (e.tool_use_id) toolUses.set(e.tool_use_id, agentId)
      const ran = await next(e)
      if (e.tool_use_id) toolUses.delete(e.tool_use_id)
      if (waiting.delete(agentId)) await editAgent($, agentId, a => (a.state === 'waiting' ? { ...a, state: 'running' } : a))
      return ran
    }
    if (!WORK_TOOLS.has(e.tool)) return next(e)
    isWaitingOnBackground = (e as unknown as Raw).run_in_background === true
    const hasLivePlan = isPlanTouched || (await read($, plans)).some(isOpenPlan)
    if (!hasLivePlan && !hasRefused && workCalls >= WORK_BEFORE_PLAN) {
      hasRefused = true

      return { deny: `plan-progress: several changes ahead. Create a bar with ${TOOL} first, then retry.` }
    }
    const ran = await next(e)
    // a shell call that only read (ls, git status, grep) is not work
    if (ran.deny !== undefined || ran.isReadOnly) return ran
    workCalls += 1
    sinceUpdate += 1
    if (hasLivePlan && sinceUpdate >= CALLS_BEFORE_NUDGE) {
      sinceUpdate = 0

      return { ...ran, context: [...(ran.context ?? []), `plan-progress: bar is stale, send {id, next:true} or {id, done, active}.`] }
    }

    return ran
  })

  // an open bar at the end of a turn: a question to the user marks it waiting on its own;
  // only a turn that did work and left the bar unexplained is sent back once
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.stop_hook_active || result.block || isWaitingOnBackground || (e.background_tasks?.length ?? 0) > 0) return result
    const open = (await read($, plans)).filter(isOpenPlan)
    if (open.length === 0) return result
    const asks = /\?\s*$/.test(e.last_assistant_message ?? '')
    if (asks) {
      const last = open[open.length - 1]
      if (last) await putPlan($, { ...last, state: 'needs_input' })

      return result
    }
    if (workCalls === 0 && !isPlanTouched) return result

    return {
      ...result,
      block: `plan-progress: ${open.map(p => p.id).join(', ')} still open. Update each with ${TOOL}: {id, next:true}, or state "done", "needs_input" or "error" with a note.`,
    }
  })

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan_progress',
      description: 'Live progress bar under the prompt, one per id. Create with title + stages; update with short ops (next, done, active, failed) or state.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Bar id; reuse it for updates' },
          title: { type: 'string' },
          kind: { enum: ['plan', 'todo'] },
          stages: {
            type: 'array',
            description: 'Full breakdown, only when creating or restructuring',
            items: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, steps: { type: 'array', items: STEP_SCHEMA } } },
          },
          next: { type: 'boolean', description: 'Active step finished, start the next one' },
          done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
          active: { type: 'string', description: 'Step title now in progress' },
          failed: { type: 'string', description: 'Step title that failed' },
          state: { enum: ['running', 'needs_input', 'error', 'done'] },
          note: { type: 'string', description: 'One line for needs_input or error' },
        },
      },
    })
    $.clock.every(1000, async () => {
      if (agentHome.size > 0 || (await $.clock.now()) < foldUntil) await update($, tick, n => n + 1)
    })
    // the terminal bar's frames: repaint the mounted Rasters in place, no render pass
    $.clock.every(FPS_MS, async () => {
      if (!band) return
      const now = await $.clock.now()
      if (!isMoving(now)) return
      const { requestId, bars } = band
      for (const b of bars) void $.ui.blit({ requestId, key: b.key, cells: rasterCells(b.plan, b.cols, now) }).catch(() => undefined)
    })
    await $.command.register({ name: 'progress', description: 'Show or hide the progress bars' })
    await $.command.register({ name: 'progress-demo', description: 'Show a sample plan in the progress bars' })
    await $.command.register({ name: 'progress-sounds', description: 'Play the decision, error and done sounds' })
    await $.command.register({ name: 'progress-clear', description: 'Remove all progress bars' })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)

    return { sections: [...result.sections, { id: 'plan-progress-fx:rules', text: RULES, scope: 'session' as const }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const raw = e as unknown as Raw
    const now = await $.clock.now()
    const list = await read($, plans)
    const id = slug(str(raw.id, 60) || str(raw.title, 80))
    const next = normalize(raw, list.find(p => p.id === id) ?? null, now, id)
    if (next.stages.length === 0) return { deny: `plan_progress: no bar "${id}" yet; create it with title and stages.` }
    isPlanTouched = true
    sinceUpdate = 0
    await putPlan($, next)
    const w = where(next)

    const active = next.stages.flatMap(st => st.steps).find(st => st.status === 'active')

    return { result: `${id}: ${Math.min(w.pos, w.total)}/${w.total}, ${next.state}${active ? `, active "${active.title}"` : ''}` }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const live = (await read($, plans)).filter(p => p.state === 'running').pop()
    if (live) await update($, plans, list => list.map(p => (p.id === live.id ? { ...p, state: 'needs_input' as const } : p)))
    play($, 'decision')
    const ran = await next(e)
    if (live) await update($, plans, list => list.map(p => (p.id === live.id && p.state === 'needs_input' ? { ...p, state: 'running' as const } : p)))

    return ran
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    play($, 'decision')
    const ran = await next(e)
    const text = ran.deny === undefined && ran.isError !== true ? (ran.result as { plan?: unknown } | undefined)?.plan : undefined
    if (typeof text === 'string') {
      const parsed = parsePlan(text, await $.clock.now())
      if (parsed) await putPlan($, { ...parsed, id: slug(parsed.title) })
    }

    return ran
  })

  on('command.run', { command: 'progress' }, async $ => {
    if ((await read($, plans)).length === 0) return { text: 'No plan yet. /progress-demo shows a sample.' }
    const open = await read($, isOpen)
    await update($, isOpen, () => !open)

    return { text: open ? 'Progress bars hidden.' : 'Progress bars shown.' }
  })

  on('command.run', { command: 'progress-demo' }, async $ => {
    const demo = DEMO(await $.clock.now())
    await putPlan($, demo)
    await update($, isOpen, () => true)
    // walk the sample to the end, so the glide, shimmer and finishing burst all show
    const left = demo.stages.flatMap(s => s.steps).filter(s => !isFinished(s.status)).length
    for (let i = 1; i <= left; i++) {
      $.clock.after(i * 900, async () => {
        const cur = (await read($, plans)).find(p => p.id === 'demo')
        if (!cur || cur.state === 'done') return
        const stages = applyOps(cur.stages, { next: true })
        const isLast = stages.flatMap(s => s.steps).every(s => isFinished(s.status))
        await putPlan($, { ...cur, stages, state: isLast ? 'done' : 'running' })
      })
    }

    return { text: 'Sample plan running under the prompt.' }
  })

  on('command.run', { command: 'progress-clear' }, async $ => {
    await update($, plans, () => [])

    return { text: 'Progress bars removed.' }
  })

  on('command.run', { command: 'progress-sounds' }, async $ => {
    play($, 'decision')
    $.clock.after(900, () => play($, 'error'))
    $.clock.after(1800, () => play($, 'done'))

    return { text: 'Sounds: decision, error, done.' }
  })

  // always drawn, so the person sees the mod is loaded; dim while there is nothing to show
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = await read($, plans)
    const count = list.length
    // a narrow screen keeps its own open flag, closed until the person opens it
    const wide = count === 0 || isWide(list, e.viewport?.columns ?? 200)
    const open = wide ? await read($, isOpen) : await read($, narrowOpen)
    const { Box, Button, Text } = $.ui.resolve(e)
    // other mods add their labels to modes beneath us; keep them
    const below = await next(e)
    const press = () =>
      count === 0
        ? $.ui.toast('plan-progress is on. A bar appears when Claude starts a task with several steps.')
        : wide
          ? update($, isOpen, () => !open)
          : update($, narrowOpen, () => !open)

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box key="progress-pill" flexDirection="row" hover={{ backgroundColor: '#2a2140' }}>
          <Button key="progress-toggle" plain dimColor={count === 0 || !open} label={open && count > 0 ? '◉' : '○'} onPress={press} />
          {[...' Progress'].map((ch, i) => (
            <Text key={`pg-${i}`} bold dimColor={count === 0 || !open} color={toHex(hsl(190 + i * 14, 0.85, 0.66))}>
              {ch}
            </Text>
          ))}
          {count > 1 ? <Text bold color="#ff6ec7">{` ${count}`}</Text> : null}
        </Box>
        {below}
      </Box>
    )
  })

  // the terminal draws the bars under the prompt (PromptHint); the band above it keeps the desktop's
  // the terminal draws the bars under the prompt (PromptHint), to the right of limit-bars' status;
  // where both don't fit they stay closed until opened, and then take the status's place
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const list = await read($, plans)
    const t = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' && 'Raster' in t ? t.Raster : null
    const cols = e.viewport?.columns ?? 100
    const wide = isWide(list, cols)
    if (!Raster || list.length === 0 || !(wide ? await read($, isOpen) : await read($, narrowOpen))) {
      if (e.surface === 'terminal') band = null
      return next(e)
    }
    const { Box, Button, Text } = t
    const below = await next(e)
    const now = await $.clock.now()
    const room = wide ? cols - STATUS_W - 2 : cols
    const titleW = titleWidth(list, room)
    const trackCols = Math.max(10, Math.min(512, room - titleW - 16))
    band = { requestId: e.requestId, bars: list.map(p => ({ key: `fx-${p.id}`, plan: p, cols: trackCols })) }
    const bars = (
      <Box key={wide ? 'pp-bars' : 'pp-solo'} flexDirection="column" flexGrow={1}>
        {list.map(p => {
          aim(p, now)
          const w = where(p)
          const pct = p.state === 'done' ? 100 : Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100)
          const title = p.title.length > titleW ? `${p.title.slice(0, Math.max(1, titleW - 1))}…` : p.title.padEnd(titleW)
          // the title runs through its state's hues; the percent wears the hue at the fill's head
          const [h0, h1] = TITLE_HUES[p.state]
          return (
            <Box key={`bar-${p.id}`} flexDirection="row" alignItems="center" gap={1}>
              <Text bold color={STATE_COLOR[p.state]}>{STATE_GLYPH[p.state]}</Text>
              <Box flexDirection="row">
                {[...title].map((ch, i) => (
                  <Text key={`t-${p.id}-${i}`} bold={p.state !== 'done'} color={toHex(hsl(h0 + ((h1 - h0) * i) / Math.max(1, titleW - 1), 0.85, 0.66))}>
                    {ch}
                  </Text>
                ))}
              </Box>
              <Raster key={`fx-${p.id}`} columns={trackCols} rows={1} cells={rasterCells(p, trackCols, now)} />
              <Text bold color={toHex(hsl(p.state === 'done' ? 150 : (pct / 100) * 320, 0.9, 0.62))}>{`${String(pct).padStart(3, FIGURE_SPACE)}%`}</Text>
              <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => dropPlan($, p.id)} />
            </Box>
          )
        })}
      </Box>
    )
    // limit-bars drew beneath us: sit beside its status, or in its place
    const [tree, hit] = swapKeyed(below, STATUS_KEY, status =>
      wide ? (
        <Box flexDirection="row" gap={2}>
          {status as RenderElement}
          {bars}
        </Box>
      ) : (
        bars
      ),
    )
    if (hit) return tree as RenderElement
    // limit-bars is above us (it does the placing) or absent
    return (
      <Box flexDirection="column">
        {below}
        {bars}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, plans)
    if (e.surface === 'terminal') return next(e)
    if (list.length === 0 || e.props.hasSurvey || !(await read($, isOpen))) {
      band = null
      return next(e)
    }
    const t = $.ui.resolve(e)
    const { Box, Button, Text } = t
    const Svg = 'Svg' in t ? t.Svg : null
    band = null
    const total = Math.max(320, (e.props.bodyColumns || 100) * 8)
    // every bar has the same width and is pinned to the right edge (fixed-width percent, close button),
    // so rows line up whatever their titles; the slack goes into the gap after the title.
    // Desktop reports ~8 CSS px per column; glyph, gaps, percent and the close button take ~126 px.
    const titleWidth = Math.min(Math.round(total * 0.3), Math.max(...list.map(p => Math.round(textWidth(p.title, 6.4)))))
    const trackW = Math.max(120, Math.min(1400, total - titleWidth - 140))
    await read($, tick)
    const now = await $.clock.now()
    // a hairline between task bars, so each bar and its agent strips read as one group
    const divider = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="1"><rect width="${total}" height="1" fill="#808080" fill-opacity=".22"/></svg>`

    return (
      <Box flexDirection="column" gap={1}>
        {list.flatMap((p, i) => {
          const v = visibleAgents(p, now)
          const stripsH = v ? 5 + stripsHeight(v.shown.length + (v.hidden.length > 0 ? 1 : 0)) : 0
          const source = v
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="${trackW}" height="${TRACK_H + stripsH}">${trackSvg(p, trackW)}<g transform="translate(0 ${TRACK_H + 5})">${stripsSvg(v, trackW, now)}</g></svg>`
            : trackSvg(p, trackW)
          const agentsAlt = v ? `; agents: ${(p.agents ?? []).map(a => `${a.title} ${a.state}`).join(', ')}` : ''
          const line = i > 0 && Svg ? [<Svg key={`div-${p.id}`} source={divider} alt="" width={total} height={1} />] : []
          const w = where(p)
          const pct = p.state === 'done' ? 100 : Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100)
          const color = STATE_COLOR[p.state]
          const stageName = p.stages[w.stage]?.name ?? ''
          const alt =
            p.state === 'done'
              ? `${p.title}: done, ${plural(w.total, 'step')}`
              : `${p.title}: ${stageName}, step ${w.step} of ${w.stageSize}, ${pct}%${p.note ? ` — ${p.note}` : ''}${agentsAlt}`
          const bar = `${'━'.repeat(Math.round(pct / 4))}${'─'.repeat(25 - Math.round(pct / 4))}`

          return [
            ...line,
            <Box key={`bar-${p.id}`} flexDirection="row" alignItems={v ? 'flex-start' : 'center'} gap={1}>
              <Text color={color}>{STATE_GLYPH[p.state]}</Text>
              <Text wrap="truncate">{p.title}</Text>
              <Box flexGrow={1} />
              {Svg ? (
                <Svg source={source} alt={alt} width={trackW} height={TRACK_H + stripsH} />
              ) : (
                <Text>
                  <Text color={color}>{bar.replace(/─/g, '')}</Text>
                  <Text dimColor>{bar.replace(/━/g, '')}</Text>
                  <Text color={color}>{` ${stageName} ${w.step}/${w.stageSize}`}</Text>
                </Text>
              )}
              <Text dimColor>{`${String(pct).padStart(3, FIGURE_SPACE)}%`}</Text>
              <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => dropPlan($, p.id)} />
            </Box>,
          ]
        })}
      </Box>
    )
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!('agentId' in started) || !started.agentId) return started
    const id = started.agentId
    const now = await $.clock.now()
    const parentHome = e.parentAgentId ? agentHome.get(e.parentAgentId) : undefined
    const home = parentHome ?? [...(await read($, plans))].reverse().find(isOpenPlan)?.id ?? AGENTS
    agentHome.set(id, home)
    const run: AgentRun = {
      id,
      title: (e.description || e.subagentType).slice(0, 60),
      state: 'running',
      tool: 'Starting',
      startedAt: now,
      endedAt: null,
      depth: parentHome ? 1 : 0,
    }
    let isNew = false
    await update($, plans, list => {
      if (list.some(p => p.id === home)) return list.map(p => (p.id === home ? addRun(p, run, e.parentAgentId, now) : p))
      isNew = true
      const auto: Plan = { id: AGENTS, title: 'Agents', kind: 'todo', stages: [], state: 'running', note: null, startedAt: now }
      return placeBar(list, addRun(auto, run, undefined, now))
    })
    if (isNew) await update($, isOpen, () => true)

    return started
  })

  // an agent waiting on a permission prompt turns its strip amber until the call goes on
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const agentId = e.tool_use_id ? toolUses.get(e.tool_use_id) : undefined
    const useId = e.tool_use_id
    // the mode often settles an ask by itself in a blink; only a call still held after a moment waits on the person
    if (agentId && useId && verdict.decision === 'ask') {
      $.clock.after(600, async () => {
        if (toolUses.get(useId) !== agentId) return
        waiting.add(agentId)
        await editAgent($, agentId, a => ({ ...a, state: 'waiting', tool: 'Needs approval' }))
      })
    }

    return verdict
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId && agentHome.has(agentId)) {
      const now = await $.clock.now()
      const isFailed = e.reason !== 'answer'
      const tool = e.reason === 'aborted' ? 'Stopped' : isFailed ? 'Failed' : 'Done'
      await editAgent($, agentId, a => ({ ...a, state: isFailed ? 'error' : 'done', tool, endedAt: now }))
      // the mod's own bar sounds through its state; a strip on a task bar sounds here
      if (isFailed && agentHome.get(agentId) !== AGENTS) play($, 'error')
      agentHome.delete(agentId)
      waiting.delete(agentId)
    }
    // a plan whose steps are all finished closes itself
    for (const p of await read($, plans)) {
      if (p.id === AGENTS) continue
      if (p.state === 'done') continue
      const steps = p.stages.flatMap(s => s.steps)
      if (steps.length > 0 && steps.every(s => isFinished(s.status))) await putPlan($, { ...p, state: 'done' })
    }

    return next(e)
  })
}
