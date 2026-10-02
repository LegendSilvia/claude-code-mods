import type { Register } from 'claude-code'

// a violet edge down the left of each reply block and a faint violet tint behind its text
const EDGE = '#8b5cf6'
const TINT = '#1b1726'

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal') return drawn
    const { Box } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Box width={1} flexShrink={0} backgroundColor={EDGE} />
        <Box flexGrow={1} flexDirection="column" backgroundColor={TINT} paddingX={1}>
          {drawn}
        </Box>
      </Box>
    )
  })
}
