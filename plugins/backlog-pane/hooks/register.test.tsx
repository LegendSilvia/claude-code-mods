import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { acBar, acceptance, activeStatus, byOrder, doneStatus, frontLists, frontMatter, parseGitStatus, searchDirs, statusesOf, toTask, when } from './register'

const TASK = `---
id: TASK-1
title: >-
  Batch-entry personnel lookup 401s — route employee name lookup through the
  backend
status: In Progress
assignee: []
created_date: '2026-09-17 00:56'
updated_date: '2026-09-17 13:19'
labels: []
parent_task_id: TASK-001
priority: high
ordinal: 1000
---

## Description
status: not front matter
`

test('front matter reads folded titles, quoted dates and skips lists', async () => {
  const f = frontMatter(TASK)
  expect(f.title).toBe('Batch-entry personnel lookup 401s — route employee name lookup through the backend')
  expect(f.updated_date).toBe('2026-09-17 13:19')
  expect(f.assignee).toBeUndefined()
  expect(f.status).toBe('In Progress')
})

test('a task file becomes a task; one without a title or status does not', async () => {
  expect(toTask(TASK, 'x')).toMatchObject({ id: 'TASK-1', status: 'In Progress', parent: 'TASK-001', priority: 'high', ordinal: 1000 })
  expect(toTask('---\nid: TASK-9\n---\n', 'x')).toBeNull()
  expect(toTask('---\r\ntitle: "Quoted: yes"\r\nstatus: To Do\r\n---\r\n', 'task-7')).toMatchObject({ id: 'task-7', title: 'Quoted: yes' })
})

test('statuses come from config.yml, else the defaults', async () => {
  expect(statusesOf('statuses: ["To Do", "In Progress", "Review", "Done"]')).toEqual(['To Do', 'In Progress', 'Review', 'Done'])
  expect(statusesOf('project_name: x')).toEqual(['To Do', 'In Progress', 'Done'])
})

test('times read as a clock today and a date before', async () => {
  const now = new Date(2026, 8, 17, 15, 0).getTime()
  expect(when('2026-09-17 13:19', now)).toBe('1:19 PM')
  expect(when('2026-09-17 00:05', now)).toBe('12:05 AM')
  expect(when('2026-09-02 09:00', now)).toBe('Sep 2')
  expect(when(undefined, now)).toBe('')
})

test('tasks sort by ordinal, then id number', async () => {
  const t = (id: string, ordinal?: number) => ({ id, title: id, status: 'To Do', labels: [], assignee: [], ac: { done: 0, total: 0 }, ordinal })
  expect([t('TASK-10'), t('TASK-2'), t('TASK-3', 500)].sort(byOrder).map(x => x.id)).toEqual(['TASK-3', 'TASK-2', 'TASK-10'])
})

test('without a backlog the pane says so', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'backlog-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'backlog',
    props: { title: 'Backlog', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  })
  expect(await ui.find({ type: 'Text', text: /No backlog/ })).toBeDefined()
})

test('git status reads branch, ahead/behind and one code per file', async () => {
  const g = parseGitStatus(
    [
      '## main...origin/main [ahead 2, behind 1]',
      ' M limit-bars/hooks.json',
      'M  reply-highlight/hooks.json',
      ' D limit-bars/hooks/register.tsx',
      '?? backlog.md',
      'R  old.ts -> new.ts',
      '',
    ].join('\n'),
  )
  expect(g).toMatchObject({ branch: 'main', ahead: 2, behind: 1 })
  expect(g.files.map(f => f.code).join('')).toBe('MMD?R')
  expect(g.files[4]!.path).toBe('new.ts')
  expect(parseGitStatus('## main\n')).toMatchObject({ branch: 'main', ahead: 0, behind: 0, files: [] })
  expect(parseGitStatus('## No commits yet on dev\n').branch).toBe('dev')
  expect(parseGitStatus('## HEAD (no branch)\n').branch).toBe('detached')
})

test('the backlog is looked for in the project and up to its repo root, never above', async () => {
  expect(searchDirs(String.raw`C:\Development\production-control-web`, 'C:/Development/production-control-web')).toEqual([
    String.raw`C:\Development\production-control-web`,
  ])
  expect(searchDirs(String.raw`C:\Dev\mono\apps\web`, 'C:/Dev/mono')).toEqual([
    String.raw`C:\Dev\mono\apps\web`,
    String.raw`C:\Dev\mono\apps`,
    String.raw`C:\Dev\mono`,
  ])
  expect(searchDirs(String.raw`C:\Development`, null)).toEqual([String.raw`C:\Development`])
})

const FULL = [
  '---',
  'id: TASK-1',
  "title: 'reply-highlight: rainbow edge'",
  'status: In Progress',
  'assignee:',
  "  - '@claude'",
  'labels:',
  '  - claude-code-mods',
  '  - reply-highlight',
  'type: bug',
  'dependencies: []',
  '---',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [x] #1 first',
  '- [ ] #2 second',
  '- [X] #3 third',
  '<!-- AC:END -->',
  '',
  '## Notes',
  '- [ ] not a criterion',
].join('\n')

test('lists, type, assignee and acceptance criteria come out of a task file', async () => {
  expect(frontLists(FULL)).toMatchObject({ labels: ['claude-code-mods', 'reply-highlight'], assignee: ['@claude'], dependencies: [] })
  expect(toTask(FULL, 'x')).toMatchObject({ type: 'bug', labels: ['claude-code-mods', 'reply-highlight'], assignee: ['claude'], ac: { done: 2, total: 3 } })
  expect(acceptance('## Acceptance Criteria\n- [x] a\n- [ ] b\n\n## Plan\n- [ ] c')).toEqual({ done: 1, total: 2 })
  expect(acceptance('no criteria')).toEqual({ done: 0, total: 0 })
})

test('the buttons move tasks to the board’s own active and done statuses', async () => {
  expect(activeStatus(['To Do', 'Doing', 'Review', 'Done'])).toBe('Doing')
  expect(doneStatus(['To Do', 'In Progress', 'Done'])).toBe('Done')
  expect(activeStatus(['Todo', 'Finished'])).toBe('In Progress')
})

test('the criteria bar fills its share in a rainbow', async () => {
  expect(acBar(1, 2, 10).filled).toBe(5)
  expect(acBar(0, 0, 10).filled).toBe(0)
  const c = acBar(4, 4, 8).colors
  expect(c.length).toBe(8)
  expect(c[0]).not.toBe(c[7])
})

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
const PANE = {
  plugin: 'backlog-pane',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'backlog',
  props: { title: 'Workspace', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
}
const todo = (id: string) => `---\nid: ${id}\ntitle: Fix the thing\nstatus: To Do\n---\n`

// a Windows project, C:\proj: a git repository with a backlog of one task; `where backlog` finds
// npm's shims; `run` holds a command before it answers; every command and listing is kept
function project(
  on: On,
  o: { task?: string; isPaneOpen?: () => boolean; run?: (argv: readonly string[]) => Promise<void>; config?: () => { text: string; mtimeMs: number } } = {},
) {
  const runs: string[][] = []
  const lists: string[] = []
  const config = () => o.config?.() ?? { text: 'statuses: ["To Do", "In Progress", "Done"]', mtimeMs: 1 }
  on('session.root', () => ({ value: 'C:\\proj' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: (o.isPaneOpen?.() ?? true) ? [{ id: 'backlog', title: 'Workspace', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('fs.exists', ($, e) => ({ value: e.path === 'C:\\proj\\backlog\\tasks' || e.path.endsWith('\\node_modules\\backlog.md\\cli.js') }))
  on('fs.list', ($, e) => {
    lists.push(e.path)
    return { value: e.path === 'C:\\proj\\backlog\\tasks' ? [{ name: 'task-1.md', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false }] : [] }
  })
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: config().mtimeMs, isLink: false } }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('task-1.md') ? (o.task ?? todo('TASK-1')) : config().text }))
  on('process.run', async ($, e) => {
    runs.push([...e.argv])
    await o.run?.(e.argv)
    if (e.argv.includes('rev-parse')) return { value: ok('C:/proj\n') }
    if (e.argv[0] === 'where') return { value: ok('C:\\npm\\backlog\r\nC:\\npm\\backlog.cmd\r\n') }
    return { value: ok('## main\n') }
  })
  return { runs, lists }
}
const gitStatus = (runs: string[][]) => runs.filter(r => r.includes('status'))

test('on Windows the backlog CLI runs through node, never a bare name or a .cmd shim', async ($, on) => {
  mock.clock(on)
  const { runs } = project(on)
  await $.command.run({ command: 'backlog', ...RUN })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'start-TASK-1' })
  const backlog = runs.filter(r => r.includes('task'))
  expect(backlog).toEqual([['node', 'C:\\npm\\node_modules\\backlog.md\\cli.js', 'task', 'edit', 'TASK-1', '-s', 'In Progress']])
  expect(runs.some(r => r[0] === 'backlog' || /\.(cmd|bat)$/i.test(r[0] ?? ''))).toBe(false)
})

test('a task id that is not a plain name is refused without running anything', async ($, on) => {
  mock.clock(on)
  const { runs } = project(on, { task: todo('"TASK-1 & calc"') })
  await $.command.run({ command: 'backlog', ...RUN })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'start-TASK-1 & calc' })
  expect(runs.filter(r => r.includes('task') || r[0] === 'where' || r.includes('--version'))).toEqual([])
  expect(await ui.find({ type: 'Text', text: /refused/ })).toBeDefined()
})

test('git status takes no optional locks and leaves non-ASCII names unquoted', async ($, on) => {
  mock.clock(on)
  const { runs } = project(on)
  await $.command.run({ command: 'backlog', ...RUN })
  expect(gitStatus(runs)[0]).toEqual(['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-b'])
})

test('a poll is skipped while the last git status still runs', async ($, on) => {
  const clock = mock.clock(on)
  let statuses = 0
  // every git status after the first takes 10 s
  const { runs } = project(on, { run: async argv => void (argv.includes('status') && ++statuses > 1 && (await clock.sleep(10_000))) })
  await $.command.run({ command: 'backlog', ...RUN })
  await clock.advance(4000)
  await clock.advance(4000)
  await clock.advance(4000)
  expect(gitStatus(runs).length).toBe(2)
  // it answered at 14 s; the 16 s poll runs again
  await clock.advance(4000)
  expect(gitStatus(runs).length).toBe(3)
})

test('polls skip git and the backlog while the pane is closed', async ($, on) => {
  const clock = mock.clock(on)
  let isPaneOpen = true
  const { runs, lists } = project(on, { isPaneOpen: () => isPaneOpen })
  await $.command.run({ command: 'backlog', ...RUN })
  const seen = { runs: runs.length, lists: lists.length }
  isPaneOpen = false
  await clock.advance(12_000)
  expect({ runs: runs.length, lists: lists.length }).toEqual(seen)
  isPaneOpen = true
  await clock.advance(4000)
  expect(gitStatus(runs).length).toBe(2)
})

test('the session starts without waiting on the first scan', async ($, on) => {
  const clock = mock.clock(on)
  // git and everything else take a minute
  project(on, { run: () => clock.sleep(60_000) })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'backlog' } }))
  let isStarted = false
  void $.session.start({ cwd: 'C:\\proj', surface: 'terminal', isInteractive: true }).then(() => {
    isStarted = true
  })
  await clock.settle()
  expect(isStarted).toBe(true)
})

test('/backlog while the first scan still runs starts no second watch', async ($, on) => {
  const clock = mock.clock(on)
  // finding the repository takes a second
  const { runs } = project(on, { run: async argv => void (argv.includes('rev-parse') && (await clock.sleep(1000))) })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'backlog' } }))
  await $.session.start({ cwd: 'C:\\proj', surface: 'terminal', isInteractive: true })
  const opened = $.command.run({ command: 'backlog', ...RUN })
  await clock.advance(1000)
  await opened
  expect(runs.filter(r => r.includes('rev-parse')).length).toBe(1)
})

test('an edit to config.yml alone shows its statuses on the next poll', async ($, on) => {
  const clock = mock.clock(on)
  let config = { text: 'statuses: ["To Do", "In Progress", "Done"]', mtimeMs: 1 }
  project(on, { config: () => config })
  await $.command.run({ command: 'backlog', ...RUN })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Review/ })).toBeUndefined()
  config = { text: 'statuses: ["To Do", "In Progress", "Review", "Done"]', mtimeMs: 2 }
  await clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: /Review/ })).toBeDefined()
})

test('Enter pressed twice while a task is being created creates it once', async ($, on) => {
  const clock = mock.clock(on)
  // task create takes a second
  const { runs } = project(on, { run: async argv => void (argv.includes('create') && (await clock.sleep(1000))) })
  await $.command.run({ command: 'backlog', ...RUN })
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'new-task', text: 'Write the docs' })
  await ui.input({ key: 'new-task', text: 'Write the docs' })
  await clock.advance(2000)
  expect(runs.filter(r => r.includes('create')).length).toBe(1)
})

test('each section sits in a rounded card in its colour, its title set into the top edge', async ($, on) => {
  mock.clock(on)
  project(on)
  await $.command.run({ command: 'backlog', ...RUN })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Box', key: 'card-git' })).toMatchObject({ props: { borderStyle: 'round', borderColor: '#69f0ae', paddingX: 1 } })
  expect(await ui.find({ type: 'Box', key: 'card-To Do' })).toMatchObject({ props: { borderStyle: 'round', borderColor: '#b388ff' } })
  expect(await ui.find({ type: 'Box', key: 'title-To Do' })).toMatchObject({ props: { position: 'absolute', top: -1, left: 0 } })
  expect(await ui.find({ type: 'Box', key: 'count-To Do' })).toMatchObject({ props: { position: 'absolute', top: -1, right: 0 } })
  expect(await ui.find({ type: 'Box', key: 'card-new' })).toMatchObject({ props: { borderStyle: 'round' } })
})
