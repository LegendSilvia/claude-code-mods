import type { Register } from 'claude-code'

// a gold edge down the left of each reply block, a warm tint behind it, and the prose in gold
const EDGE = '#d4a017'
const TINT = '#1d1810'
const GOLD = '#e6c069'
const BRIGHT = '#ffd97a'
const HEADING = '#ffcf4d'
const CODE = '#f5e6b8'
const CODE_BG = '#2c2414'
const QUOTE = '#a8915a'

export type Span = { text: string; kind: 'plain' | 'bold' | 'italic' | 'code' | 'link' }
export type Line = { kind: 'blank' | 'heading' | 'item' | 'quote' | 'text'; prefix: string; spans: Span[] }

// fenced code and tables keep Claude Code's own drawing; everything else is drawn here in gold
export const isProse = (text: string) => !/^\s*```/m.test(text) && !/^\s*\|.*\|\s*$/m.test(text)

export function spans(text: string): Span[] {
  const out: Span[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]+\)|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<!\w)_([^_\s][^_]*)_(?!\w)/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), kind: 'plain' })
    if (m[1] !== undefined) out.push({ text: m[1], kind: 'bold' })
    else if (m[2] !== undefined) out.push({ text: m[2], kind: 'code' })
    else if (m[3] !== undefined) out.push({ text: m[3], kind: 'link' })
    else out.push({ text: (m[4] ?? m[5])!, kind: 'italic' })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: 'plain' })
  return out
}

export function lines(text: string): Line[] {
  return text
    .replace(/\s+$/, '')
    .split('\n')
    .map(raw => {
      if (raw.trim() === '') return { kind: 'blank', prefix: '', spans: [] }
      const heading = /^#{1,6}\s+(.*)$/.exec(raw)
      if (heading) return { kind: 'heading', prefix: '', spans: spans(heading[1]!) }
      const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw)
      if (item) {
        const marker = /\d/.test(item[2]!) ? item[2]! : '•'
        return { kind: 'item', prefix: `${item[1]}${marker} `, spans: spans(item[3]!) }
      }
      const quote = /^>\s?(.*)$/.exec(raw)
      if (quote) return { kind: 'quote', prefix: '│ ', spans: spans(quote[1]!) }
      return { kind: 'text', prefix: '', spans: spans(raw) }
    })
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const prose = isProse(e.props.text)
    const drawn = prose ? null : await next(e)

    const span = (s: Span, key: string, base: string) => {
      switch (s.kind) {
        case 'bold':
          return (
            <Text key={key} bold color={BRIGHT}>
              {s.text}
            </Text>
          )
        case 'italic':
          return (
            <Text key={key} italic color={base}>
              {s.text}
            </Text>
          )
        case 'code':
          return (
            <Text key={key} color={CODE} backgroundColor={CODE_BG}>
              {s.text}
            </Text>
          )
        case 'link':
          return (
            <Text key={key} underline color={BRIGHT}>
              {s.text}
            </Text>
          )
        default:
          return (
            <Text key={key} color={base}>
              {s.text}
            </Text>
          )
      }
    }

    const body = prose ? (
      <Box flexDirection="column">
        {lines(e.props.text).map((l, i) => {
          if (l.kind === 'blank') return <Text key={`l-${i}`}> </Text>
          const base = l.kind === 'heading' ? HEADING : l.kind === 'quote' ? QUOTE : GOLD
          return (
            <Text key={`l-${i}`} bold={l.kind === 'heading'}>
              {l.prefix ? (
                <Text key={`p-${i}`} color={l.kind === 'quote' ? EDGE : BRIGHT}>
                  {l.prefix}
                </Text>
              ) : null}
              {l.spans.map((s, k) => span(s, `s-${i}-${k}`, base))}
            </Text>
          )
        })}
      </Box>
    ) : (
      drawn
    )

    return (
      <Box flexDirection="row">
        <Box width={1} flexShrink={0} backgroundColor={EDGE} />
        <Box flexGrow={1} flexDirection="row" backgroundColor={TINT} paddingX={1} gap={1}>
          {/* the reply's opening star; later blocks keep the same indent */}
          {prose ? (
            <Box flexShrink={0} width={1}>
              <Text color={HEADING}>{e.props.isFirstOfReply ? '✦' : ' '}</Text>
            </Box>
          ) : null}
          <Box flexGrow={1} flexDirection="column">
            {body}
          </Box>
        </Box>
      </Box>
    )
  })
}
