import { expect, test } from 'claude-code/testing'

import { byOrder, frontMatter, statusesOf, toTask, when } from './register'

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
  const ui = await $.ui.mount({
    plugin: 'backlog-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'backlog',
    props: { title: 'Backlog', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  })
  expect(await ui.find({ type: 'Text', text: /No backlog/ })).toBeDefined()
})
