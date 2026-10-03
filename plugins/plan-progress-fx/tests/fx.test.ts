import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { lineColumns } from '../hooks/register'

const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const HINT = { isDraft: false, isWorking: true, hint: '? for shortcuts' }

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }

test('the terminal draws the demo under the prompt as an animated Raster that runs to done', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // stands in for the engine's own hint line
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, '? for shortcuts') as RenderElement
  })
  await $.command.run({ command: 'progress-demo', ...RUN })
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
    return h(Box, {}) as RenderElement
  })
  await $.command.run({ command: 'progress-demo', ...RUN })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('the desktop keeps its SVG bar', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  await $.command.run({ command: 'progress-demo', ...RUN })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

// stands in for limit-bars' status beneath us: a Box keyed lb-status
function status(on: On) {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' }, h(Text, { dimColor: true }, '? for shortcuts'), h(Box, { key: 'lb-status' }, h(Text, {}, 'rings'))) as RenderElement
  })
}

test('a wide screen draws the bars beside the status', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  status(on)
  await $.command.run({ command: 'progress-demo', ...RUN })
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
    return h(Text, { dimColor: true }, 'auto mode on') as RenderElement
  })
  await $.command.run({ command: 'progress-demo', ...RUN })
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
    return h(Text, {}, 'pokemon') as RenderElement
  })
  await $.command.run({ command: 'progress-demo', ...RUN })
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

const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// the sounds as the host plays them: what reaches the engine's player and what runs as a command
function host(on: On, root: string) {
  const played: string[] = []
  const runs: string[][] = []
  on('session.root', () => ({ value: root }))
  // the engine's player resolves on every platform, whether it played or not
  on('audio.play', ($, e) => {
    played.push(('asset' in e.clip && e.clip.asset) || '')
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: ok }
  })
  return { played, runs }
}

test('a Windows session plays the sounds through PowerShell', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { played, runs } = host(on, 'C:\\Users\\me\\project')
  await $.command.run({ command: 'progress-sounds', ...RUN })
  await clock.advance(2000)
  expect(played).toEqual([])
  expect(runs.map(r => r[0])).toEqual(['powershell', 'powershell', 'powershell'])
  expect(runs[0]?.at(-1)).toMatch(/^\(New-Object Media\.SoundPlayer '.+\\sounds\\decision\.wav'\)\.PlaySync\(\)$/)
})

test('elsewhere the sounds go to the engine player', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { played, runs } = host(on, '/Users/me/project')
  await $.command.run({ command: 'progress-sounds', ...RUN })
  await clock.advance(2000)
  expect(played).toEqual(['sounds/decision.wav', 'sounds/error.wav', 'sounds/done.wav'])
  expect(runs).toEqual([])
})

test('/progress on a narrow screen opens and closes the bars there', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  status(on)
  await $.command.run({ command: 'progress-demo', ...RUN })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 100, rows: 50 } })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await $.command.run({ command: 'progress', ...RUN })).text).toBe('Progress bars shown.')
  expect(await ui.find({ type: 'Box', key: 'pp-solo' })).toBeDefined()
  expect((await $.command.run({ command: 'progress', ...RUN })).text).toBe('Progress bars hidden.')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('/progress on a wide screen hides and shows the bars there', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  status(on)
  await $.command.run({ command: 'progress-demo', ...RUN })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 200, rows: 50 } })
  expect(await ui.find({ type: 'Box', key: 'pp-bars' })).toBeDefined()
  expect((await $.command.run({ command: 'progress', ...RUN })).text).toBe('Progress bars hidden.')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await $.command.run({ command: 'progress', ...RUN })).text).toBe('Progress bars shown.')
  expect(await ui.find({ type: 'Box', key: 'pp-bars' })).toBeDefined()
})

// the share of a Raster's cells drawn as fill ('▀'); each cell is three 32-bit words, its glyph first
function filled(bar: { props: Record<string, unknown> } | undefined): number {
  const bytes = Uint8Array.from(atob(String(bar?.props.cells ?? '')), c => c.charCodeAt(0))
  const words = new DataView(bytes.buffer)
  const cells = bytes.length / 12
  let n = 0
  for (let x = 0; x < cells; x++) if (words.getUint32(x * 12, true) === 0x2580) n++
  return n / Math.max(1, cells)
}

test('a demo after /progress-clear starts at its own share, not gliding back from 100%', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  status(on)
  await $.command.run({ command: 'progress-demo', ...RUN })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 200, rows: 50 } })
  await clock.advance(11 * 900 + 1000)
  expect(filled(await ui.find({ type: 'Raster', key: 'fx-demo' }))).toBeGreaterThan(0.5)
  await $.command.run({ command: 'progress-clear', ...RUN })
  await $.command.run({ command: 'progress-demo', ...RUN })
  // 5 of 16 steps done
  expect(filled(await ui.find({ type: 'Raster', key: 'fx-demo' }))).toBeLessThan(0.35)
})

test('/progress-demo run twice keeps one step every 900 ms', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  status(on)
  await $.command.run({ command: 'progress-demo', ...RUN })
  await $.command.run({ command: 'progress-demo', ...RUN })
  const ui = await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 200, rows: 50 } })
  // 5 of 16 steps done, then one more
  expect(await ui.find({ type: 'Text', text: /31%$/ })).toBeDefined()
  await clock.advance(900)
  expect(await ui.find({ type: 'Text', text: /38%$/ })).toBeDefined()
})

test('/progress-debug shows the width the prompt line was told beside the terminal width', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, '? for shortcuts') as RenderElement
  })
  await $.command.run({ command: 'progress-demo', ...RUN })
  await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 112, rows: 50 } })
  const { text } = await $.command.run({ command: 'progress-debug', ...RUN, presentation: { isFullscreen: true, columns: 208 } })
  expect(text).toContain('terminal: 208 columns')
  expect(text).toContain('prompt line told: 112 columns')
  expect(text).toMatch(/laid out: (wide|narrow)/)
})

test('a moving bar repaints about 10 times a second, not more', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, '? for shortcuts') as RenderElement
  })
  let blits = 0
  on('ui.blit', () => {
    blits++
    return {}
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'progress-demo', ...RUN })
  await $.ui.mount({ plugin: 'plan-progress-fx', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 200, rows: 50 } })
  blits = 0
  await clock.advance(1000)
  expect(blits).toBeGreaterThan(0)
  expect(blits).toBeLessThanOrEqual(11)
})
