import { expect, test } from 'claude-code/testing'

import { isProse, lines, rainbowColors, spans } from './register'

test('inline markdown splits into spans', async () => {
  expect(spans('a **b** `c` [d](http://x) *e* f')).toEqual([
    { text: 'a ', kind: 'plain' },
    { text: 'b', kind: 'bold' },
    { text: ' ', kind: 'plain' },
    { text: 'c', kind: 'code' },
    { text: ' ', kind: 'plain' },
    { text: 'd', kind: 'link' },
    { text: ' ', kind: 'plain' },
    { text: 'e', kind: 'italic' },
    { text: ' f', kind: 'plain' },
  ])
  expect(spans('snake_case_name stays plain')).toEqual([{ text: 'snake_case_name stays plain', kind: 'plain' }])
})

test('block lines keep headings, bullets, numbers and quotes', async () => {
  const l = lines('# Title\n\n- one\n2. two\n> said\nplain')
  expect(l.map(x => x.kind)).toEqual(['heading', 'blank', 'item', 'item', 'quote', 'text'])
  expect(l[2]!.prefix).toBe('• ')
  expect(l[3]!.prefix).toBe('2. ')
})

test('code fences and tables are left to Claude Code', async () => {
  expect(isProse('just words')).toBe(true)
  expect(isProse('see\n```ts\nx\n```')).toBe(false)
  expect(isProse('| a | b |\n| --- | --- |')).toBe(false)
})

test('the terminal draws prose itself, bold in rainbow, with the opening star', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-highlight',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Hello **there**', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Text', text: 't' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Hello ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✦' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
})

test('a code block keeps the engine drawing inside the panel', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-highlight',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```\ncode\n```', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('the desktop draws replies as it always has', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-highlight',
    surface: 'desktop',
    component: 'AssistantMessage',
    props: { text: 'Hello', isFirstOfReply: true },
  })
  expect(await ui.drawn()).toMatchObject({ type: 'Text' })
})

test('rainbow gives each letter its own hue across the span', async () => {
  const c = rainbowColors('abcdef')
  expect(c.map(x => x.ch).join('')).toBe('abcdef')
  expect(new Set(c.map(x => x.color)).size).toBe(6)
  expect(c[0]!.color).toMatch(/^#[0-9a-f]{6}$/)
})
