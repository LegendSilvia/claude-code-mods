import { expect, test } from 'claude-code/testing'

import { edgeColors, edgeSegments, estimateRows, isProse, lines, rainbow, rainbowColors, spans } from './register'

test('inline markdown splits into spans', async () => {
  expect(spans('a **b** `c` [d](http://x) *e* f')).toEqual([
    { text: 'a ', kind: 'plain' },
    { text: 'b', kind: 'bold' },
    { text: ' ', kind: 'plain' },
    { text: 'c', kind: 'code' },
    { text: ' ', kind: 'plain' },
    { text: 'd', kind: 'link', url: 'http://x' },
    { text: ' ', kind: 'plain' },
    { text: 'e', kind: 'italic' },
    { text: ' f', kind: 'plain' },
  ])
  expect(spans('snake_case_name stays plain')).toEqual([{ text: 'snake_case_name stays plain', kind: 'plain' }])
})

test('bold italic is one span, with no stray asterisks', async () => {
  expect(spans('a ***b c*** **d** *e*')).toEqual([
    { text: 'a ', kind: 'plain' },
    { text: 'b c', kind: 'bold-italic' },
    { text: ' ', kind: 'plain' },
    { text: 'd', kind: 'bold' },
    { text: ' ', kind: 'plain' },
    { text: 'e', kind: 'italic' },
  ])
})

test('a link becomes a Link where its URL can be one, else its URL shows beside the text', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-highlight',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'see [the docs](https://example.com/a b), [notes](ftp://host/f) and [http://example.com](http://example.com)', isFirstOfReply: true },
  })
  const link = await ui.find({ type: 'Link' })
  expect(link).toMatchObject({ props: { href: 'https://example.com/a%20b' } })
  expect(link?.text).toContain('the docs')
  expect(await ui.find({ type: 'Text', text: 'notes (ftp://host/f)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /and http:\/\/example\.com$/ })).toBeDefined()
})

test('bold italic draws without its asterisks', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-highlight',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'a ***big*** deal', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Text', text: /big/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\*/ })).toBeUndefined()
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

test('the edge is sliced into equal-growing segments that span the whole spectrum', async () => {
  expect(estimateRows('one line', 100)).toBe(3)
  expect(estimateRows('x'.repeat(200), 50)).toBe(7)
  expect(edgeSegments(3)).toBe(6)
  expect(edgeSegments(20)).toBe(20)
  expect(edgeSegments(500)).toBe(48)
  const c = edgeColors(6)
  expect(c.length).toBe(6)
  expect(c[0]).toBe(rainbow(0))
  expect(c[5]).toBe(rainbow(300))
})

test('the drawn edge is background-coloured boxes that grow, not rows of text', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-highlight',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Hello', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Box', key: 'edge-0' })).toMatchObject({ props: { flexGrow: 1, backgroundColor: rainbow(0) } })
  expect(await ui.find({ type: 'Box', key: 'edge-5' })).toMatchObject({ props: { backgroundColor: rainbow(300) } })
  expect(await ui.find({ type: 'Text', text: '█' })).toBeUndefined()
})
