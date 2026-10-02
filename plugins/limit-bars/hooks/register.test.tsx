import { expect, mock, test } from 'claude-code/testing'

import { effortBadge, folderOf, shortModel, pick, pluck, pie, RING_COLS, RING_ROWS, ringCells, RINGS, tokens } from './register'

const LIMITS = [
  { kind: 'five_hour', percentUsed: 42 },
  { kind: 'seven_day', percentUsed: 13.5 },
  { kind: 'seven_day_fable', percentUsed: 91 },
]

test('rings map five_hour, seven_day and the Fable window', async () => {
  const [s, w, f] = pick(LIMITS)
  expect(s?.percentUsed).toBe(42)
  expect(w?.percentUsed).toBe(13.5)
  expect(f?.percentUsed).toBe(91)
  expect(pick([])[2]).toBeUndefined()
})

test('folder and token labels', async () => {
  expect(folderOf('C:\\Development')).toBe('Development')
  expect(folderOf('/home/me/proj/')).toBe('proj')
  expect(tokens(130000)).toBe('130k')
  expect(tokens(1000000)).toBe('1M')
  expect(tokens(undefined)).toBe('—')
})

test('every ring is one block of cells, read or not', async () => {
  const size = (RING_COLS * RING_ROWS * 12 * 4) / 3
  RINGS.forEach((_, i) => {
    expect(ringCells(i, 13, 0).length).toBe(size)
    expect(ringCells(i, 100, 0).length).toBe(size)
    expect(ringCells(i, undefined, 0).length).toBe(size)
  })
  expect(pie(0)).toBe('○')
  expect(pie(50)).toBe('◑')
  expect(pie(100)).toBe('●')
})

test('four rings and the model draw under the prompt hint, no labels', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>? for shortcuts</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'limit-bars',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect(await ui.find({ type: 'Text', text: /◆/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Session|Weekly|Context/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('pluck lifts a keyed element out of a tree', async () => {
  const tree = { type: 'Box', children: [{ type: 'Text', children: ['hint'] }, { type: 'Box', props: { key: 'pp-bars' }, children: [] }] }
  const [rest, found] = pluck(tree, ['pp-bars', 'pp-solo'])
  expect(found?.props?.key).toBe('pp-bars')
  expect((rest as { children: unknown[] }).children.length).toBe(1)
  expect(pluck(tree, ['nope'])[1]).toBeNull()
})

for (const [key, hasStatus] of [['pp-bars', true], ['pp-solo', false]] as const) {
  test(`progress bars beneath (${key}) sit ${hasStatus ? 'beside' : 'in place of'} the status`, async ($, on) => {
    mock.clock(on)
    on('ui.render', ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>? for shortcuts</Text>
          <Box key={key}>
            <Text>bars</Text>
          </Box>
        </Box>
      )
    })
    const ui = await $.ui.mount({
      plugin: 'limit-bars',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect(await ui.find({ type: 'Text', text: 'bars' })).toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'lb-status' })) !== undefined).toBe(hasStatus)
  })
}

test('effort draws as its label, coloured by level', async () => {
  expect(effortBadge(null)).toBeNull()
  expect(effortBadge('medium')?.label).toBe('medium')
  expect(effortBadge('low')?.color).not.toBe(effortBadge('max')?.color)
  expect(effortBadge('4096')?.label).toBe('4096')
})

test('the model drops its claude- prefix', async () => {
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5[1m]')
  expect(shortModel('sonnet')).toBe('sonnet')
  expect(shortModel(undefined)).toBe('…')
})
