import { expect, test } from 'claude-code/testing'

const PROPS = { text: 'Hello from Claude', isFirstOfReply: true }

test('the terminal wraps a reply in an edge and a tinted panel, keeping the engine drawing', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Hello from Claude</Text>
  })
  const ui = await $.ui.mount({ plugin: 'reply-highlight', surface: 'terminal', component: 'AssistantMessage', props: PROPS })
  expect(await ui.find({ type: 'Text', text: 'Hello from Claude' })).toBeDefined()
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'row' } })
})

test('the desktop draws replies as it always has', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Hello from Claude</Text>
  })
  const ui = await $.ui.mount({ plugin: 'reply-highlight', surface: 'desktop', component: 'AssistantMessage', props: PROPS })
  expect(await ui.drawn()).toMatchObject({ type: 'Text' })
})
