import { expect, mock, test } from 'claude-code/testing'
import { lineColumns } from '../hooks/register'

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
  // status (66) + gap (2) + glyph, title, track, percent, close and their gaps fit inside 200 columns
  const track = (await ui.find({ type: 'Raster' })) as { props: { columns: number } } | undefined
  const title = 'Orders module'.length
  expect(66 + 2 + 1 + 1 + title + 1 + (track?.props.columns ?? 999) + 1 + 4 + 1 + 1).toBeLessThanOrEqual(200)
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

test('a docked pane reports the window width, so the bars stay beside the status', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  status(on)
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'pokemon')
  })
  await $.command.run({ command: 'progress-demo' })
  // another plugin's pane, docked 80 wide in a 210-wide window
  await $.ui.mount({
    plugin: 'plan-progress-fx',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pokemon',
    props: { title: 'Pokemon', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
    viewport: { columns: 210, rows: 50 },
  })
  // the line under the prompt is told the transcript column's width
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 128, rows: 50 } })
  expect(await ui.find({ type: 'Box', key: 'pp-bars' })).toBeDefined()
})

test('lineColumns widens only a width that matches the column beside a docked pane', async () => {

  expect(lineColumns(128, { full: 210, body: 80 })).toBe(210)
  expect(lineColumns(210, { full: 210, body: 80 })).toBe(210)
  expect(lineColumns(90, { full: 210, body: 80 })).toBe(90)
  expect(lineColumns(128, null)).toBe(128)
})
