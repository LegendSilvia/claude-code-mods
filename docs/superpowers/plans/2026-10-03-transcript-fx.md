# transcript-fx Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that draws gold tool blocks, teal prompt panels, an animated spinner bar, a rainbow turn footer and a rainbow rule above the prompt.

**Architecture:** One hooks module (`plugins/transcript-fx/hooks/register.tsx`) with `ui.render` hooks on `ToolUse`, `ToolResult`, `ToolGroup`, `UserMessage`, `Spinner`, `TurnDuration` and `AbovePrompt`. Rows whose props carry everything are drawn from scratch; `ToolResult` and `Spinner` wrap the engine's tree (`await next(e)`). Pure helpers are exported from the same file for tests, as `reply-highlight` does. Settings live in `$.store` and are mirrored into a `$.state` atom.

**Tech Stack:** Claude Code 2.1.288 function-hook plugin API (`claude-code`, `claude-code/testing`), TSX against the engine's `h`, `claude plugin validate` / `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-03-transcript-fx-design.md`

## Global Constraints

- Plugin folder: `plugins/transcript-fx`; plugin name `transcript-fx`; command `/fx` (never `/chrome`).
- Colours: `GOLD_HI #ffd86b`, `GOLD_LO #c9962b`, `GOLD #f5c542`, `GOLD_TINT #221d12`, `TEAL_TINT #12222a`, `OK #30a46c`, `ERR #e5484d`, `VIOLET #b388ff`.
- Parts: `tools`, `spinner`, `prompts`, `footer`, `rule`; all on by default.
- Every hook passes (`return next(e)`) when `e.surface !== 'terminal'`, when its part is off, and when its drawing throws.
- Hooked components only: `ToolUse`, `ToolResult`, `ToolGroup`, `UserMessage`, `Spinner`, `TurnDuration`, `AbovePrompt`. Never `AssistantMessage`, `PromptHint`, `SessionMode`, `Pane`.
- `endedAt` is capped at the 500 most recent entries.
- No DOM, no Node: no `Buffer`, no `btoa`, no `path`. Base64 by hand (as plan-progress-fx).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Windows paths: `E:\Dev\x\a.ts` with cwd `e:/dev/x` must summarise as `a.ts` (case-insensitive, either slash).
- A multi-line or very long Bash command must stay one header row (first line only, cut with `…`).
- `/fx` with odd input (`/fx`, `/fx TOOLS OFF`, `/fx tools maybe`, `/fx nope on`) must never change settings except the valid case-insensitive form.
- A footer redrawn later (scroll, reload) must keep its first time, not the redraw time.
- The band above the prompt must never cover pokecli's battle band or a survey.

Each of these has a test in the task that owns the code.

---

## File Structure

```
plugins/transcript-fx/
  .claude-plugin/plugin.json   manifest (name, version, description, types)
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           palette, pure helpers (exported), hooks
  hooks/register.test.tsx      helper + render tests
  types/index.d.ts             $.state contract
.claude-plugin/marketplace.json   + transcript-fx entry
README.md                         + transcript-fx row and /fx table
```

One module, like every other plugin in this repo. Helpers sit at the top of `register.tsx`, hooks in `register` at the bottom.

---

### Task 1: Scaffold and pure helpers

**Files:**
- Create: `plugins/transcript-fx/.claude-plugin/plugin.json`
- Create: `plugins/transcript-fx/hooks/hooks.json`
- Create: `plugins/transcript-fx/types/index.d.ts`
- Create: `plugins/transcript-fx/hooks/register.tsx`
- Create: `plugins/transcript-fx/hooks/register.test.tsx`
- Modify: `.claude-plugin/marketplace.json` (append to `plugins`)

**Interfaces:**
- Produces (exported from `register.tsx`):
  - `type Part`, `type Settings` (re-exported from `../types`), `PARTS: readonly Part[]`, `DEFAULTS: Settings`
  - colour constants `GOLD_HI GOLD_LO GOLD GOLD_TINT TEAL_TINT OK ERR VIOLET`
  - `rainbow(hue: number): string`
  - `goldEdge(n: number): string[]`
  - `iconFor(tool: string): string`
  - `toolLabel(tool: string): string`
  - `relPath(path: string, cwd: string): string`
  - `truncate(s: string, n: number): string`
  - `summarize(tool: string, input: unknown, cwd: string): string`
  - `groupLine(calls: ReadonlyArray<{ tool: string }>): string`
  - `fmtDuration(ms: number): string`
  - `fmtClock(ms: number): string`
  - `parseFx(args: string): { kind: 'show' } | { kind: 'set'; part: Part; on: boolean } | { kind: 'error' }`
  - `register: Register` (empty in this task)

- [ ] **Step 1: Write the manifest, hooks.json, contract and marketplace entry**

`plugins/transcript-fx/.claude-plugin/plugin.json`:
```json
{
  "name": "transcript-fx",
  "version": "0.1.0",
  "description": "Gold tool blocks, teal prompt panels, an animated spinner bar and a rainbow turn footer in the transcript",
  "author": { "name": "LegendSilvia", "url": "https://github.com/LegendSilvia" },
  "license": "MIT",
  "homepage": "https://github.com/LegendSilvia/claude-code-mods",
  "types": "./types/index.d.ts"
}
```

`plugins/transcript-fx/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`plugins/transcript-fx/types/index.d.ts`:
```ts
export type Part = 'tools' | 'spinner' | 'prompts' | 'footer' | 'rule'
export type Settings = Record<Part, boolean>

declare module 'claude-code' {
  interface PluginState {
    'transcript-fx': { settings: Settings; endedAt: Record<string, number> }
  }
}
```

Append to `plugins` in `.claude-plugin/marketplace.json`:
```json
    {
      "name": "transcript-fx",
      "source": "./plugins/transcript-fx",
      "description": "Gold tool blocks, teal prompt panels, an animated spinner bar and a rainbow turn footer in the transcript"
    }
```

- [ ] **Step 2: Write the failing helper tests**

`plugins/transcript-fx/hooks/register.test.tsx`:
```tsx
import { expect, test } from 'claude-code/testing'

import { DEFAULTS, GOLD_HI, GOLD_LO, fmtClock, fmtDuration, goldEdge, groupLine, iconFor, parseFx, relPath, summarize, toolLabel, truncate } from './register'

test('icons by tool kind', async () => {
  expect(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].map(iconFor)).toEqual(['✎', '✎', '✎', '✎'])
  expect(['Read', 'Glob', 'Grep'].map(iconFor)).toEqual(['⌕', '⌕', '⌕'])
  expect(['Bash', 'PowerShell'].map(iconFor)).toEqual(['❯', '❯'])
  expect(['WebFetch', 'WebSearch'].map(iconFor)).toEqual(['◍', '◍'])
  expect(['Agent', 'Task', 'Skill'].map(iconFor)).toEqual(['✦', '✦', '✦'])
  expect(iconFor('mcp__claude_ai_Github_MCP__list_commits')).toBe('⬡')
  expect(iconFor('TodoWrite')).toBe('•')
})

test('MCP tool names shorten to server·tool', async () => {
  expect(toolLabel('mcp__claude_ai_Github_MCP__list_commits')).toBe('Github_MCP·list_commits')
  expect(toolLabel('mcp__plan-progress-fx__plan_progress')).toBe('plan-progress-fx·plan_progress')
  expect(toolLabel('Bash')).toBe('Bash')
})

test('paths inside the cwd become relative, whatever the case or slash', async () => {
  expect(relPath('E:\\Dev\\x\\src\\a.ts', 'e:/dev/x')).toBe('src/a.ts')
  expect(relPath('/home/u/p/a.ts', '/home/u/p/')).toBe('a.ts')
  expect(relPath('/etc/hosts', '/home/u/p')).toBe('/etc/hosts')
  expect(relPath('E:\\Dev\\xy\\a.ts', 'E:\\Dev\\x')).toBe('E:/Dev/xy/a.ts')
})

test('truncate cuts with an ellipsis and never below one character', async () => {
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(truncate('abc', 4)).toBe('abc')
  expect(truncate('abcdef', 0)).toBe('…')
})

test('summaries per tool', async () => {
  const cwd = 'E:/Dev/x'
  expect(summarize('Write', { file_path: 'E:\\Dev\\x\\docs\\plan.md', content: 'x' }, cwd)).toBe('docs/plan.md')
  expect(summarize('NotebookEdit', { notebook_path: 'E:/Dev/x/n.ipynb' }, cwd)).toBe('n.ipynb')
  expect(summarize('Bash', { command: 'git status\ngit log' }, cwd)).toBe('git status')
  expect(summarize('Grep', { pattern: 'component:', path: 'plugins' }, cwd)).toBe('"component:" in plugins')
  expect(summarize('Grep', { pattern: 'x' }, cwd)).toBe('"x"')
  expect(summarize('Glob', { pattern: '**/*.ts' }, cwd)).toBe('**/*.ts')
  expect(summarize('WebFetch', { url: 'https://a.b/c' }, cwd)).toBe('https://a.b/c')
  expect(summarize('WebSearch', { query: 'ink box' }, cwd)).toBe('ink box')
  expect(summarize('Agent', { description: 'Find hooks', prompt: '…' }, cwd)).toBe('Find hooks')
  expect(summarize('Skill', { skill: 'plugin-authoring' }, cwd)).toBe('plugin-authoring')
  expect(summarize('Mystery', { a: 1 }, cwd)).toBe('')
  expect(summarize('Bash', null, cwd)).toBe('')
  expect(summarize('Bash', 'not an object', cwd)).toBe('')
})

test('a group line counts calls per tool in first-seen order', async () => {
  expect(groupLine([{ tool: 'Read' }, { tool: 'Grep' }, { tool: 'Read' }, { tool: 'Read' }, { tool: 'Grep' }])).toBe('Read ×3 · Grep ×2')
  expect(groupLine([{ tool: 'Glob' }])).toBe('Glob')
})

test('the gold edge runs from light to deep gold at any length', async () => {
  expect(goldEdge(1)).toEqual([GOLD_HI])
  const e = goldEdge(6)
  expect(e.length).toBe(6)
  expect(e[0]).toBe(GOLD_HI)
  expect(e[5]).toBe(GOLD_LO)
  expect(e.every(c => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
})

test('durations and clock times', async () => {
  expect(fmtDuration(3_400)).toBe('3s')
  expect(fmtDuration(64_000)).toBe('1m 4s')
  expect(fmtDuration(170_000)).toBe('2m 50s')
  expect(fmtDuration(3_720_000)).toBe('1h 2m')
  const d = new Date(2026, 9, 3, 15, 42)
  expect(fmtClock(d.getTime())).toBe('3:42 PM')
  expect(fmtClock(new Date(2026, 9, 3, 0, 5).getTime())).toBe('12:05 AM')
})

test('/fx arguments', async () => {
  expect(parseFx('')).toEqual({ kind: 'show' })
  expect(parseFx('  ')).toEqual({ kind: 'show' })
  expect(parseFx('tools off')).toEqual({ kind: 'set', part: 'tools', on: false })
  expect(parseFx('TOOLS ON')).toEqual({ kind: 'set', part: 'tools', on: true })
  expect(parseFx('tools maybe')).toEqual({ kind: 'error' })
  expect(parseFx('nope on')).toEqual({ kind: 'error' })
  expect(parseFx('tools')).toEqual({ kind: 'error' })
  expect(DEFAULTS).toEqual({ tools: true, spinner: true, prompts: true, footer: true, rule: true })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — `register.tsx` does not exist / exports missing.

- [ ] **Step 4: Write the helpers**

`plugins/transcript-fx/hooks/register.tsx`:
```tsx
import type { Register } from 'claude-code'

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

export function parseFx(args: string): { kind: 'show' } | { kind: 'set'; part: Part; on: boolean } | { kind: 'error' } {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: 'show' }
  const [part, value] = words
  if (words.length !== 2 || !PARTS.includes(part as Part) || (value !== 'on' && value !== 'off')) return { kind: 'error' }
  return { kind: 'set', part: part as Part, on: value === 'on' }
}

export const register: Register = () => {}
```

- [ ] **Step 5: Run the tests and validate**

Run: `claude plugin test plugins/transcript-fx && claude plugin validate plugins/transcript-fx`
Expected: all tests PASS; validate reports no errors.

- [ ] **Step 6: Commit**

```bash
git add plugins/transcript-fx .claude-plugin/marketplace.json
git commit -m "transcript-fx: scaffold and pure helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings and the `/fx` command

**Files:**
- Modify: `plugins/transcript-fx/hooks/register.tsx` (imports, atoms, `register`)
- Test: `plugins/transcript-fx/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `PARTS`, `DEFAULTS`, `parseFx` (Task 1).
- Produces:
  - `settings` atom: `atom({ plugin: 'transcript-fx', key: 'settings' } as const, DEFAULTS)`
  - `endedAt` atom: `atom({ plugin: 'transcript-fx', key: 'endedAt' } as const, {} as Record<string, number>)`
  - `isOn($, part: Part): Promise<boolean>` (module-local helper used by every hook)
  - `/fx` registered at `session.start`; settings loaded from `$.store.get('settings')`

- [ ] **Step 1: Write the failing tests**

Append to `register.test.tsx` (add `RUN` near the imports):
```tsx
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }

test('/fx lists the parts, all on by default', async $ => {
  const r = await $.command.run({ command: 'fx', ...RUN })
  expect(r.text).toContain('tools: on')
  expect(r.text).toContain('rule: on')
})

test('/fx <part> off turns one part off and is remembered in the store', async $ => {
  expect((await $.command.run({ command: 'fx', ...RUN, args: 'Spinner OFF' })).text).toBe('transcript-fx: spinner off.')
  expect((await $.command.run({ command: 'fx', ...RUN })).text).toContain('spinner: off')
  expect(await $.store.get('settings')).toMatchObject({ spinner: false, tools: true })
})

test('/fx with bad arguments answers the usage and changes nothing', async $ => {
  for (const args of ['tools maybe', 'nope on', 'tools']) {
    expect((await $.command.run({ command: 'fx', ...RUN, args })).text).toBe('Usage: /fx [tools|spinner|prompts|footer|rule] [on|off]')
  }
  expect((await $.command.run({ command: 'fx', ...RUN })).text).not.toContain(': off')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — command `fx` is not registered.

- [ ] **Step 3: Implement settings and `/fx`**

Change the imports at the top of `register.tsx`:
```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
```

Add below the helpers:
```tsx
const settings = atom({ plugin: 'transcript-fx', key: 'settings' } as const, DEFAULTS)
const endedAt = atom({ plugin: 'transcript-fx', key: 'endedAt' } as const, {} as Record<string, number>)
const USAGE = `Usage: /fx [${PARTS.join('|')}] [on|off]`

const isOn = async ($: EngineInterface, part: Part) => (await read($, settings))[part]
```

Replace `export const register: Register = () => {}` with:
```tsx
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('settings')
    if (saved && typeof saved === 'object') await update($, settings, () => ({ ...DEFAULTS, ...(saved as Partial<Settings>) }))
    await $.command.register({ name: 'fx', description: 'Show or toggle transcript-fx parts' })
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
}
```

If the test harness does not run `session.start` before `command.run`, the tests fail with "unknown command"; in that case raise it first in each test with `await $.classic.SessionStart({ source: 'startup' })` (see reference.md, "The test's `classic` noun").

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/transcript-fx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/transcript-fx
git commit -m "transcript-fx: settings and /fx" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Gold tool blocks (`ToolUse`, `ToolResult`, `ToolGroup`)

**Files:**
- Modify: `plugins/transcript-fx/hooks/register.tsx`
- Test: `plugins/transcript-fx/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `iconFor`, `toolLabel`, `summarize`, `truncate`, `goldEdge`, `groupLine`, colours (Task 1); `isOn` (Task 2).
- Produces: module-local `edge(Box, colors, side: 'left' | 'right')` used by Tasks 4 and 6:
  ```tsx
  function edge(Box: any, colors: string[], side: 'left' | 'right') // absolute 1-column column of growing boxes
  ```
  and `edgeSegments(text: string, columns: number): number` (6–48 slices).

- [ ] **Step 1: Write the failing tests**

Append to `register.test.tsx`:
```tsx
const engineDraws = (on: any, component: string) =>
  on('ui.render', { component }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const USE = { tool_use_id: 't1', tool: 'Write', input: { file_path: '/p/docs/plan.md' }, isRunning: false, isErrored: false, isInterrupted: false }

test('a tool header draws icon, name, summary and status in gold', async ($, on) => {
  engineDraws(on, 'ToolUse')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: USE, viewport: { columns: 100, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: '✎' })).toMatchObject({ props: { color: '#f5c542' } })
  expect(await ui.find({ type: 'Text', text: 'Write' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /plan\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓' })).toMatchObject({ props: { color: '#30a46c' } })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
})

test('running, errored and interrupted calls show their own status', async ($, on) => {
  engineDraws(on, 'ToolUse')
  const cases = [
    [{ isRunning: true }, '◐'],
    [{ isErrored: true }, '✗'],
    [{ isInterrupted: true, isErrored: true }, '⊘'],
  ] as const
  for (const [flags, glyph] of cases) {
    const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: { ...USE, ...flags } })
    expect(await ui.find({ type: 'Text', text: glyph })).toBeDefined()
  }
})

test('a long multi-line command stays one row', async ($, on) => {
  engineDraws(on, 'ToolUse')
  const command = `${'x'.repeat(300)}\nsecond line`
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: { ...USE, tool: 'Bash', input: { command } }, viewport: { columns: 80, rows: 40 } })
  const summary = await ui.find({ type: 'Text', text: /^x+…$/ })
  expect(summary).toBeDefined()
  expect([...summary!.text].length).toBeLessThan(80)
  expect(await ui.find({ type: 'Text', text: /second line/ })).toBeUndefined()
})

test('a tool result keeps the engine drawing inside a gold-edged panel', async ($, on) => {
  engineDraws(on, 'ToolResult')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 't1', tool: 'Write', output: {}, isErrored: false } })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'edge-0' })).toMatchObject({ props: { backgroundColor: '#ffd86b' } })
})

test('a folded group draws one gold count line; an expanded one passes', async ($, on) => {
  engineDraws(on, 'ToolGroup')
  const calls = [{ tool: 'Read' }, { tool: 'Read' }, { tool: 'Grep' }]
  const folded = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } as any })
  expect(await folded.find({ type: 'Text', text: 'Read ×2 · Grep' })).toBeDefined()
  const open = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: true } as any })
  expect(await open.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('tools pass on the desktop and when turned off', async ($, on) => {
  engineDraws(on, 'ToolUse')
  const desk = await $.ui.mount({ plugin: 'transcript-fx', surface: 'desktop', component: 'ToolUse', props: USE })
  expect(await desk.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await $.command.run({ command: 'fx', ...RUN, args: 'tools off' })
  const term = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: USE })
  expect(await term.find({ type: 'Text', text: 'engine' })).toBeDefined()
})
```

(`ToolGroupCall` may carry more fields than `tool`; the `as any` keeps the test to what the hook reads. If `validate` complains, fill the extra fields from the `ToolGroupCall` declaration in the API types.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — the new tests find `engine` where gold rows are expected.

- [ ] **Step 3: Implement the tool hooks**

Add below the atoms in `register.tsx`:
```tsx
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
  p.isInterrupted ? { glyph: '⊘', color: undefined, dim: true } : p.isErrored ? { glyph: '✗', color: ERR, dim: false } : p.isRunning ? { glyph: '◐', color: GOLD, dim: false } : { glyph: '✓', color: OK, dim: false }
```

Add inside `register`, after the `/fx` hook:
```tsx
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'tools'))) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      const label = toolLabel(e.props.tool)
      const room = (e.viewport?.columns ?? 100) - label.length - 10
      const summary = truncate(summarize(e.props.tool, e.props.input, await $.session.cwd()), room)
      const s = status(e.props)
      return (
        <Box flexDirection="row">
          {edge(Box, goldEdge(2), 'left')}
          <Box width={1} flexShrink={0} />
          <Box flexGrow={1} flexDirection="row" gap={1} paddingX={1}>
            <Text color={GOLD}>{iconFor(e.props.tool)}</Text>
            <Text bold color={GOLD}>{label}</Text>
            <Box flexGrow={1}>
              <Text dimColor>{summary}</Text>
            </Box>
            <Text color={s.color} dimColor={s.dim}>{s.glyph}</Text>
          </Box>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'tools'))) return next(e)
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
```

Note: `ToolResult` calls `next(e)` once, before drawing, so the catch returns that tree rather than calling `next` twice.

- [ ] **Step 4: Run the tests and validate**

Run: `claude plugin test plugins/transcript-fx && claude plugin validate plugins/transcript-fx`
Expected: PASS, no validate errors. If validate refuses a prop (`position`, `overflow`, `gap`), compare with `reply-highlight/hooks/register.tsx`, which uses the same props, and match its spelling.

- [ ] **Step 5: Commit**

```bash
git add plugins/transcript-fx
git commit -m "transcript-fx: gold tool headers, results and groups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Teal prompt panels (`UserMessage`)

**Files:**
- Modify: `plugins/transcript-fx/hooks/register.tsx`
- Test: `plugins/transcript-fx/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `edge`, `edgeSegments`, `rainbow`, `TEAL_TINT`, `isOn`.

- [ ] **Step 1: Write the failing tests**

```tsx
const MSG = (kind: string) => ({ text: '/pokemon size large', origin: { kind }, isExpanded: true }) as any

test('a typed prompt draws in a teal panel with a you tag and a right rainbow edge', async ($, on) => {
  engineDraws(on, 'UserMessage')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'UserMessage', props: MSG('composer') })
  expect(await ui.find({ type: 'Text', text: '/pokemon size large' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'you' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'panel' })).toMatchObject({ props: { backgroundColor: '#12222a' } })
  expect(await ui.find({ type: 'Box', key: 'edge-0' })).toBeDefined()
})

test('notifications and other senders keep the engine drawing', async ($, on) => {
  engineDraws(on, 'UserMessage')
  for (const kind of ['task-notification', 'peer', 'scheduled-trigger']) {
    const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'UserMessage', props: MSG(kind) })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — `you` not found.

- [ ] **Step 3: Implement**

Add inside `register`:
```tsx
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
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
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/transcript-fx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/transcript-fx
git commit -m "transcript-fx: teal prompt panels" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rainbow turn footer (`TurnDuration`)

**Files:**
- Modify: `plugins/transcript-fx/hooks/register.tsx`
- Test: `plugins/transcript-fx/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `endedAt` atom, `fmtDuration`, `fmtClock`, `rainbow`, `VIOLET`, `isOn`.

- [ ] **Step 1: Write the failing tests**

```tsx
test('the footer reads star, rainbow word, duration and the time it ended', async ($, on) => {
  engineDraws(on, 'TurnDuration')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 170_000 }, requestId: 'turn-1' } as any)
  expect(await ui.find({ type: 'Text', text: '✦' })).toMatchObject({ props: { color: '#b388ff' } })
  expect(await ui.find({ type: 'Text', text: 'b' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /in 2m 50s · \d{1,2}:\d{2} (AM|PM)/ })).toBeDefined()
})

test('a footer drawn again keeps its first time', async ($, on) => {
  engineDraws(on, 'TurnDuration')
  const mount = () => $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3_000 }, requestId: 'turn-2' } as any)
  const first = (await (await mount()).find({ type: 'Text', text: /· / }))!.text
  await $.clock.advance(5 * 60_000)
  const again = (await (await mount()).find({ type: 'Text', text: /· / }))!.text
  expect(again).toBe(first)
})
```

If `$.ui.mount` does not take `requestId`, or `$.clock.advance` is named differently, look up the `mount` and clock declarations in the testing types (`grep -n "mount(" .claude-plugin/types/claude-code/index.d.ts`) and use what they declare.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — `✦` not found.

- [ ] **Step 3: Implement**

Add inside `register`:
```tsx
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'footer'))) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      let at = (await read($, endedAt))[e.requestId]
      if (at === undefined) {
        const now = await $.clock.now()
        at = now
        // the first drawing records when the turn ended; keep the newest 500
        await update($, endedAt, m => Object.fromEntries([...Object.entries(m), [e.requestId, now] as const].slice(-500)))
      }
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
          <Text dimColor>{`in ${fmtDuration(e.props.durationMs)} · ${fmtClock(at)}`}</Text>
        </Box>
      )
    } catch {
      return next(e)
    }
  })
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/transcript-fx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/transcript-fx
git commit -m "transcript-fx: rainbow turn footer with its end time" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Spinner bar (`Spinner`)

**Files:**
- Modify: `plugins/transcript-fx/hooks/register.tsx`
- Test: `plugins/transcript-fx/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `rainbow`, `isOn`.
- Produces (exported): `BAR = 10`, `barCells(t: number): string` (base64 Raster cells for one frame), `barGlyphs(t: number): string` (the frame as text, for tests).

- [ ] **Step 1: Write the failing tests**

```tsx
import { BAR, barCells, barGlyphs } from './register'   // merge into the existing import line

test('the spinner bar sweeps four lit cells across ten', async () => {
  expect(barGlyphs(0)).toBe('▰▱▱▱▱▱▱▱▱▱')
  expect(barGlyphs(3 * 80)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(barGlyphs(9 * 80)).toBe('▱▱▱▱▱▱▰▰▰▰')
  expect([...barGlyphs(12345)].length).toBe(BAR)
  // 10 cells × 3 u32 × 4 bytes = 120 bytes = 160 base64 characters
  expect(barCells(0).length).toBe(160)
})

test('the spinner keeps the engine line beside the bar', async ($, on) => {
  engineDraws(on, 'Spinner')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'Spinner', props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' } })
  expect(await ui.find({ type: 'Raster', key: 'bar' })).toMatchObject({ props: { columns: 10, rows: 1 } })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — `barGlyphs` not exported.

- [ ] **Step 3: Implement**

Add to the helpers in `register.tsx`:
```tsx
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
```

Inside `register`, above the first `on(...)`:
```tsx
  // spinners on screen, repainted in place each frame without a render pass
  const spinners = new Set<string>()
```

In the `session.start` hook, before `return next(e)`:
```tsx
    $.clock.every(FRAME_MS, async () => {
      if (spinners.size === 0) return
      const cells = barCells(await $.clock.now())
      for (const requestId of spinners) void $.ui.blit({ requestId, key: 'bar', cells }).catch(() => spinners.delete(requestId))
    })
```

Add the hook:
```tsx
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'spinner'))) return next(e)
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
```

- [ ] **Step 4: Run the tests and validate**

Run: `claude plugin test plugins/transcript-fx && claude plugin validate plugins/transcript-fx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/transcript-fx
git commit -m "transcript-fx: animated spinner bar beside the engine line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Rainbow rule above the prompt (`AbovePrompt`)

**Files:**
- Modify: `plugins/transcript-fx/hooks/register.tsx`
- Test: `plugins/transcript-fx/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `rainbow`, `isOn`.

The band is free only when `next(e)` resolves to the engine's own drawing (`{ type: 'engine', ... }`) and no survey is up (`e.props.hasSurvey`). Anything else is another plugin's tree (pokecli's battle band) or a survey, and is returned unchanged.

- [ ] **Step 1: Write the failing tests**

```tsx
const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 40, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test('the rule draws across the band when nothing else uses it', async $ => {
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: { columns: 40, rows: 30 } })
  expect(await ui.find({ type: 'Box', key: 'rule' })).toBeDefined()
})

test("another plugin's band and a survey are left alone", async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>battle</Text>
  })
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await ui.find({ type: 'Text', text: 'battle' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'rule' })).toBeUndefined()
})

test('a survey keeps the band', async $ => {
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
  expect(await ui.find({ type: 'Box', key: 'rule' })).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test plugins/transcript-fx`
Expected: FAIL — `rule` not found in the first test.

- [ ] **Step 3: Implement**

```tsx
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey || (drawn as { type?: string }).type !== 'engine' || !(await isOn($, 'rule'))) return drawn
    try {
      const { Box, Text } = $.ui.resolve(e)
      const width = Math.max(1, e.viewport?.columns ?? e.props.bodyColumns ?? 80)
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
```

If the first test fails because the harness's bottom answers something other than `{ type: 'engine' }` with no hook beneath, print `JSON.stringify(await ui.drawn())` from a scratch test, and match on what it shows the engine's empty band to be.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/transcript-fx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/transcript-fx
git commit -m "transcript-fx: rainbow rule above the prompt when the band is free" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: README, full check and live check

**Files:**
- Modify: `README.md` (plugin table, install list, a `/fx` table, Develop list)

- [ ] **Step 1: Update the README**

Add a row to the plugin table:
```markdown
| **transcript-fx** | Restyles the rest of the transcript to match: tool calls as gold rows (an icon per kind, a short summary, ✓ / ✗ / ◐) with their results in a gold-edged panel, folded tool runs as one gold count line, your prompts in a teal panel with a rainbow edge on the right, an animated rainbow bar in front of the spinner (its time and tokens kept), a `✦ baked in 2m 50s · 3:42 PM` footer, and a rainbow rule above the prompt when nothing else uses that band. `/fx` turns each part on or off. |
```

Add `claude plugin install transcript-fx@claude-code-mods` to the install block, `claude plugin test plugins/transcript-fx` to the Develop block, and after the plan-progress-fx command table:
```markdown
### transcript-fx commands

| Command | Does |
| --- | --- |
| `/fx` | List the parts and whether each is on |
| `/fx <part> on\|off` | Turn one part on or off: `tools`, `spinner`, `prompts`, `footer`, `rule` (remembered across sessions) |
```

- [ ] **Step 2: Run every check**

Run:
```bash
claude plugin validate plugins/transcript-fx
claude plugin test plugins/transcript-fx
claude plugin test plugins/reply-highlight
claude plugin test plugins/plan-progress-fx
```
Expected: all PASS (the other plugins are unchanged; this guards against marketplace edits breaking them).

- [ ] **Step 3: Live check**

Load the plugin in a session: `claude --plugin-dir plugins/transcript-fx` (or hot reloading). Then:
- Run a Read, a Grep, an Edit and a Bash call; confirm gold headers, gold-edged results, and a folded `Read ×N` line.
- Press ctrl+o: confirm expanded group rows still show their output. A `ToolUse` row inside an expanded group draws its result inline, and the hook replaces the whole row, so that output may be lost there. The hook cannot tell an expanded-group row from a standalone one. If output is lost, stop and report it to the person with a screenshot; do not change scope without their answer.
- Type a prompt and a slash command; confirm the teal panel on the prompt, and record whether the slash command echo got it.
- Watch the spinner animate; confirm time and tokens still show.
- Confirm the footer reads `✦ <word> in … · <time>`.
- Start a pokecli battle (`/pokemon on`) and confirm its band is not covered by the rule.
- Screenshot next to the original one.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "transcript-fx: README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
