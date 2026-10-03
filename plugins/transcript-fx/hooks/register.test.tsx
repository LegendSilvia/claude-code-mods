import { expect, mock, test } from 'claude-code/testing'

import { BAR, DEFAULTS, GOLD_HI, GOLD_LO, fmtClock, fmtDuration, goldEdge, groupLine, iconFor, parseFx, relPath, summarize, toolLabel, truncate, barCells, barGlyphs } from './register'

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }

// nothing stands beneath a test's plugins: the store is the test's to answer
const fakeStore = (on: any) => {
  const data = new Map<string, unknown>()
  on('store.get', ($: any, e: { key: string }) => ({ value: data.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => {
    data.set(e.key, e.value)
    return { value: undefined }
  })
  return data
}

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

test('/fx lists the parts, all on by default', async $ => {
  const r = await $.command.run({ command: 'fx', ...RUN })
  expect(r.text).toContain('tools: on')
  expect(r.text).toContain('rule: on')
})

test('/fx <part> off turns one part off and is remembered in the store', async ($, on) => {
  const store = fakeStore(on)
  expect((await $.command.run({ command: 'fx', ...RUN, args: 'Spinner OFF' })).text).toBe('transcript-fx: spinner off.')
  expect((await $.command.run({ command: 'fx', ...RUN })).text).toContain('spinner: off')
  expect(store.get('settings')).toMatchObject({ spinner: false, tools: true })
})

test('/fx with bad arguments answers the usage and changes nothing', async $ => {
  for (const args of ['tools maybe', 'nope on', 'tools']) {
    expect((await $.command.run({ command: 'fx', ...RUN, args })).text).toBe('Usage: /fx [tools|spinner|prompts|footer|rule] [on|off]')
  }
  expect((await $.command.run({ command: 'fx', ...RUN })).text).not.toContain(': off')
})

const engineDraws = (on: any, component: string) =>
  on('ui.render', { component }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

// the session's working directory, which a header's paths are relative to
const inProject = (on: any) => on('session.cwd', () => ({ value: '/p' }))

const USE = { tool_use_id: 't1', tool: 'Write', input: { file_path: '/p/docs/plan.md' }, isRunning: false, isErrored: false, isInterrupted: false }

test('a tool header draws icon, name, summary and status in gold', async ($, on) => {
  inProject(on)
  engineDraws(on, 'ToolUse')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: USE, viewport: { columns: 100, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: '✎' })).toMatchObject({ props: { color: '#f5c542' } })
  expect(await ui.find({ type: 'Text', text: 'Write' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /plan\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓' })).toMatchObject({ props: { color: '#30a46c' } })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
})

test('running, errored and interrupted calls show their own status', async ($, on) => {
  inProject(on)
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
  inProject(on)
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
  fakeStore(on)
  engineDraws(on, 'ToolUse')
  const desk = await $.ui.mount({ plugin: 'transcript-fx', surface: 'desktop', component: 'ToolUse', props: USE })
  expect(await desk.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await $.command.run({ command: 'fx', ...RUN, args: 'tools off' })
  const term = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: USE })
  expect(await term.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('a header still draws, with the path as given, when the cwd cannot be read', async ($, on) => {
  engineDraws(on, 'ToolUse')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: USE })
  expect(await ui.find({ type: 'Text', text: '/p/docs/plan.md' })).toBeDefined()
})

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

const AT_342 = new Date(2026, 9, 3, 15, 42).getTime()

// a main-loop turn ends, as the engine raises it; the test answers beneath the plugin
const answersTurns = (on: any) => on('turn.complete', () => ({ text: '' }))
const endTurn = async ($: any, durationMs: number) => {
  await $.turn.complete({ answer: '', durationMs, isAborted: false, turnId: 'turn', reason: 'answer' })
}

test('the footer reads star, rainbow word, duration and the time it ended', async ($, on) => {
  mock.clock(on, { now: AT_342 })
  answersTurns(on)
  engineDraws(on, 'TurnDuration')
  await endTurn($, 170_000)
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 170_000 }, requestId: 'turn-1' })
  expect(await ui.find({ type: 'Text', text: '✦' })).toMatchObject({ props: { color: '#b388ff' } })
  expect(await ui.find({ type: 'Text', text: 'b' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'in 2m 50s · 3:42 PM' })).toBeDefined()
})

test('a footer drawn again keeps its first time', async ($, on) => {
  const clock = mock.clock(on, { now: AT_342 })
  answersTurns(on)
  engineDraws(on, 'TurnDuration')
  await endTurn($, 3_000)
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3_000 }, requestId: 'turn-2' })
  expect(await ui.find({ type: 'Text', text: 'in 3s · 3:42 PM' })).toBeDefined()
  await clock.advance(5 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'in 3s · 3:42 PM' })).toBeDefined()
})

test('a footer with no turn just ended shows its duration and no time, never a wrong one', async ($, on) => {
  mock.clock(on, { now: AT_342 })
  answersTurns(on)
  engineDraws(on, 'TurnDuration')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3_000 }, requestId: 'turn-old' })
  expect(await ui.find({ type: 'Text', text: /^in 3s$/ })).toBeDefined()
})

test('the spinner bar sweeps four lit cells across ten', async () => {
  expect(barGlyphs(0)).toBe('▰▱▱▱▱▱▱▱▱▱')
  expect(barGlyphs(3 * 80)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(barGlyphs(9 * 80)).toBe('▱▱▱▱▱▱▰▰▰▰')
  expect([...barGlyphs(12345)].length).toBe(BAR)
  // 10 cells × 3 u32 × 4 bytes = 120 bytes = 160 base64 characters
  expect(barCells(0).length).toBe(160)
})

test('the spinner keeps the engine line beside the bar', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engineDraws(on, 'Spinner')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'Spinner', props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' } })
  expect(await ui.find({ type: 'Raster', key: 'bar' })).toMatchObject({ props: { columns: 10, rows: 1 } })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 40, scroll: { offset: 0, bodyRows: 10 }, view: {} }

// the engine's own band, as core answers next(e): its drawing by reference
const coreBand = (on: any) => on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

test('the rule draws across the band when nothing else uses it', async ($, on) => {
  coreBand(on)
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

test('a survey keeps the band', async ($, on) => {
  coreBand(on)
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
  expect(await ui.find({ type: 'Box', key: 'rule' })).toBeUndefined()
})

// final review fixes

test('a spinner that is gone stops the frame timer', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  fakeStore(on)
  let blits = 0
  on('ui.blit', () => {
    blits++
    return { deny: 'not mounted' }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  engineDraws(on, 'Spinner')
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'Spinner', props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' } })
  await clock.advance(80)
  await clock.advance(800)
  expect(blits).toBe(1)
})

test('an older footer never takes a later turn’s time', async ($, on) => {
  mock.clock(on, { now: AT_342 })
  answersTurns(on)
  engineDraws(on, 'TurnDuration')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3_000 }, requestId: 'turn-resumed' })
  await endTurn($, 3_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^in 3s$/ })).toBeDefined()
})

test('a footer takes a turn’s time only when the durations match', async ($, on) => {
  mock.clock(on, { now: AT_342 })
  answersTurns(on)
  engineDraws(on, 'TurnDuration')
  await endTurn($, 60_000)
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3_000 }, requestId: 'turn-other' })
  expect(await ui.find({ type: 'Text', text: /^in 3s$/ })).toBeDefined()
})

test('rows of an expanded group keep the engine drawing, with their results', async ($, on) => {
  engineDraws(on, 'ToolGroup')
  engineDraws(on, 'ToolUse')
  const calls = [{ tool_use_id: 'g1', tool: 'Read', input: {}, isRunning: false, isErrored: false }]
  await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: true } as any })
  const row = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: { ...USE, tool_use_id: 'g1', tool: 'Read' }, requestId: 'g1' })
  expect(await row.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('the header label and summary clip at the real width rather than wrap', async ($, on) => {
  inProject(on)
  engineDraws(on, 'ToolUse')
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'ToolUse', props: USE })
  expect(await ui.find({ type: 'Text', text: 'docs/plan.md' })).toMatchObject({ props: { wrap: 'truncate-end' } })
  expect(await ui.find({ type: 'Text', text: 'Write' })).toMatchObject({ props: { wrap: 'truncate-end' } })
})

test('the rule spans the band body, not the whole window', async ($, on) => {
  coreBand(on)
  const ui = await $.ui.mount({ plugin: 'transcript-fx', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 70 }, viewport: { columns: 120, rows: 30 } })
  const rule = (await ui.find({ type: 'Box', key: 'rule' })) as { children?: unknown[] } | undefined
  expect(rule?.children?.length).toBe(70)
})
