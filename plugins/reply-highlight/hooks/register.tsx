import type { Register } from 'claude-code'

// a violet edge down the left of each reply block and a violet tint behind it; the prose keeps the
// terminal's own colour, and what Claude bolds (and headings) runs through a rainbow
const TINT = '#1b1726'
const ACCENT = '#b388ff'
const CODE_BG = '#2d2440'

// a hue in degrees to #rrggbb at fixed saturation and lightness, bright enough for a dark panel
export function rainbow(hue: number): string {
  const s = 0.9
  const l = 0.68
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const c = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return `#${[0, 8, 4].map(n => c(n).toString(16).padStart(2, '0')).join('')}`
}

// how many rows a block takes at this width, rounded up: the edge draws that many and the
// box clips any extra, so a guess on the high side costs nothing
export function estimateRows(text: string, columns: number): number {
  const width = Math.max(10, columns - 6)
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / width)), 0) + 2
}

// the edge: one block per row, the spectrum spread from the block's top to its bottom
export const edgeColors = (rows: number) => Array.from({ length: rows }, (_, i) => rainbow((i / Math.max(1, rows)) * 300))

// one hue per character, a whole spectrum across the span however long it is
export const rainbowColors = (text: string) => {
  const n = [...text].length
  return [...text].map((ch, i) => ({ ch, color: rainbow((i / Math.max(1, n)) * 300) }))
}

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

    const bow = (text: string, key: string, extra: { underline?: boolean } = {}) => (
      <Text key={key} bold underline={extra.underline}>
        {rainbowColors(text).map((c, i) => (
          <Text key={`${key}-${i}`} color={c.color}>
            {c.ch}
          </Text>
        ))}
      </Text>
    )

    const span = (s: Span, key: string) => {
      switch (s.kind) {
        case 'bold':
          return bow(s.text, key)
        case 'italic':
          return (
            <Text key={key} italic>
              {s.text}
            </Text>
          )
        case 'code':
          return (
            <Text key={key} color={ACCENT} backgroundColor={CODE_BG}>
              {s.text}
            </Text>
          )
        case 'link':
          return (
            <Text key={key} underline color={ACCENT}>
              {s.text}
            </Text>
          )
        default:
          return <Text key={key}>{s.text}</Text>
      }
    }

    const body = prose ? (
      <Box flexDirection="column">
        {lines(e.props.text).map((l, i) => {
          if (l.kind === 'blank') return <Text key={`l-${i}`}> </Text>
          const text = l.spans.map(x => x.text).join('')
          return (
            <Text key={`l-${i}`} dimColor={l.kind === 'quote'}>
              {l.prefix ? (
                <Text key={`p-${i}`} color={ACCENT}>
                  {l.prefix}
                </Text>
              ) : null}
              {l.kind === 'heading' ? bow(text, `h-${i}`) : l.spans.map((x, k) => span(x, `s-${i}-${k}`))}
            </Text>
          )
        })}
      </Box>
    ) : (
      drawn
    )

    return (
      <Box flexDirection="row">
        {/* placed over the row's left column, so its rows never make the block taller */}
        <Box position="absolute" top={0} bottom={0} left={0} width={1} flexDirection="column" overflow="hidden">
          {edgeColors(estimateRows(e.props.text, e.viewport?.columns ?? 100)).map((c, i) => (
            <Text key={`edge-${i}`} color={c}>
              █
            </Text>
          ))}
        </Box>
        <Box width={1} flexShrink={0} />
        <Box flexGrow={1} flexDirection="row" backgroundColor={TINT} paddingX={1} gap={1}>
          {/* the reply's opening star; later blocks keep the same indent */}
          {prose ? (
            <Box flexShrink={0} width={1}>
              <Text color={ACCENT}>{e.props.isFirstOfReply ? '✦' : ' '}</Text>
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
