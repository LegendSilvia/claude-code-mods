import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 } }

const HINT = { isDraft: false, isWorking: true, hint: '? for shortcuts' }

test('the terminal draws the demo under the prompt as an animated Raster that runs to done', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // stands in for the engine's own hint line
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, '? for shortcuts')
  })
  await $.command.run({ command: 'progress-demo' })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 200, rows: 50 } })
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()

  const bar = await ui.find({ type: 'Raster', key: 'fx-demo' })
  expect(bar).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /%$/ })).toBeDefined()

  // the demo has 11 steps left, one every 900 ms
  await clock.advance(11 * 900 + 100)
  expect(await ui.find({ type: 'Text', text: '100%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
})

test('the terminal band above the prompt stays empty', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {})
  })
  await $.command.run({ command: 'progress-demo' })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('the desktop keeps its SVG bar', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  await $.command.run({ command: 'progress-demo' })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

// stands in for limit-bars' status beneath us: a Box keyed lb-status
function status(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' }, h(Text, { dimColor: true }, '? for shortcuts'), h(Box, { key: 'lb-status' }, h(Text, {}, 'rings')))
  })
}

test('a wide screen draws the bars beside the status', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  status(on)
  await $.command.run({ command: 'progress-demo' })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 200, rows: 50 } })
  expect(await ui.find({ type: 'Text', text: 'rings' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'pp-bars' })).toBeDefined()
})

test('a narrow screen keeps the bars closed until opened, then they replace the status', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  status(on)
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'auto mode on')
  })
  await $.command.run({ command: 'progress-demo' })
  const viewport = { columns: 100, rows: 50 }
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'rings' })).toBeDefined()

  const mode = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport })
  await mode.press({ key: 'progress-toggle' })
  expect(await ui.find({ type: 'Box', key: 'pp-solo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'rings' })).toBeUndefined()
})
