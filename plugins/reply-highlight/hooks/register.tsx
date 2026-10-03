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

// about how many rows a block takes at this width; only sets how finely the edge is sliced
export function estimateRows(text: string, columns: number): number {
  const width = Math.max(10, columns - 6)
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / width)), 0) + 2
}

// the edge's slices: the layout shares the block's real height among them, so the spectrum runs
// from its top row to its bottom row however the text wraps; on a short block the extra slices get
// no rows, on a tall one each stretches
export const edgeSegments = (rows: number) => Math.min(48, Math.max(6, rows))
export const edgeColors = (segments: number) =>
  Array.from({ length: segments }, (_, i) => rainbow((i / Math.max(1, segments - 1)) * 300))

// one hue per character, a whole spectrum across the span however long it is
export const rainbowColors = (text: string) => {
  const n = [...text].length
  return [...text].map((ch, i) => ({ ch, color: rainbow((i / Math.max(1, n)) * 300) }))
}

export type Span = { text: string; kind: 'plain' | 'bold' | 'bold-italic' | 'italic' | 'code' | 'link'; url?: string }
export type Line = { kind: 'blank' | 'heading' | 'item' | 'quote' | 'text'; prefix: string; spans: Span[] }

// fenced code and tables keep Claude Code's own drawing; everything else is drawn here in gold
export const isProse = (text: string) => !/^\s*```/m.test(text) && !/^\s*\|.*\|\s*$/m.test(text)

export function spans(text: string): Span[] {
  const out: Span[] = []
  const re = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<!\w)_([^_\s][^_]*)_(?!\w)/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), kind: 'plain' })
    if (m[1] !== undefined) out.push({ text: m[1], kind: 'bold-italic' })
    else if (m[2] !== undefined) out.push({ text: m[2], kind: 'bold' })
    else if (m[3] !== undefined) out.push({ text: m[3], kind: 'code' })
    else if (m[4] !== undefined) out.push({ text: m[4], kind: 'link', url: m[5] })
    else out.push({ text: (m[6] ?? m[7])!, kind: 'italic' })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: 'plain' })
  return out
}

// the href a Link takes (https, or http on localhost, printable ASCII with no raw @, as URL spells
// it); null for any other, whose URL is then drawn as text beside the link's
export function linkHref(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) return null
    return /^[!-?A-~]{1,2048}$/.test(u.href) ? u.href : null
  } catch {
    return null
  }
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
    const { Box, Link, Text } = $.ui.resolve(e)
    const prose = isProse(e.props.text)
    const drawn = prose ? null : await next(e)

    const bow = (text: string, key: string, extra: { underline?: boolean; italic?: boolean } = {}) => (
      <Text key={key} bold underline={extra.underline} italic={extra.italic}>
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
        case 'bold-italic':
          return bow(s.text, key, { italic: true })
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
        case 'link': {
          // drawn here, so the URL would be lost: a Link keeps it, else it shows beside the text
          const href = s.url === undefined ? null : linkHref(s.url)
          const label = (
            <Text underline color={ACCENT}>
              {href || s.url === undefined || s.url === s.text ? s.text : `${s.text} (${s.url})`}
            </Text>
          )
          return href ? (
            <Link key={key} href={href}>
              {label}
            </Link>
          ) : (
            <Text key={key}>{label}</Text>
          )
        }
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
          {edgeColors(edgeSegments(estimateRows(e.props.text, e.viewport?.columns ?? 100))).map((c, i) => (
            <Box key={`edge-${i}`} flexGrow={1} backgroundColor={c} />
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
