import { expect, test } from 'claude-code/testing'

import { DEFAULTS, GOLD_HI, GOLD_LO, fmtClock, fmtDuration, goldEdge, groupLine, iconFor, parseFx, relPath, summarize, toolLabel, truncate } from './register'

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
