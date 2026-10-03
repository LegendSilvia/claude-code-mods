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
