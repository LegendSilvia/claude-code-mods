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
  const t = (id: string, ordinal?: number) => ({ id, title: id, status: 'To Do', ordinal })
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
