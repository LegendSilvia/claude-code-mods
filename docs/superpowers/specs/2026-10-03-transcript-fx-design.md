# transcript-fx — design

Date: 2026-10-03 · Status: approved in chat, awaiting spec review

## Goal

Restyle the parts of the Claude Code terminal that still use the engine's default look, so the whole
screen matches the existing mods (limit-bars, plan-progress-fx, reply-highlight, backlog-pane):

- tool calls (`● Write(...)`, `└ Wrote 55 lines`, `Read 3 files`)
- the spinner while a turn runs and the closing `Baked for 2m 50s` line
- the person's own prompts echoed in the transcript
- the area around the prompt input

Success: a session shows gold tool blocks, teal prompt panels, an animated spinner bar and a rainbow
footer, beside reply-highlight's violet replies, with no information lost (diffs, Bash output,
spinner time and tokens) and no clash with the other mods.

## Constraints (from the plugin API, Claude Code 2.1.288)

- A mod can redraw `ToolUse`, `ToolResult`, `ToolGroup`, `Spinner`, `TurnDuration`, `UserMessage`
  and `AbovePrompt` through `ui.render` hooks.
- The prompt input box itself is not hookable; only the band above it (`AbovePrompt`), the hint line
  under it (`PromptHint`) and the mode labels (`SessionMode`) are.
- `Spinner` props carry `word`, `message`, `suffix`, `mode`; elapsed time and tokens are not props.
  Drawing a tree in its place would lose them, so the spinner is wrapped, never replaced.
- `ToolResult` is drawn by each tool's own renderer (diffs, Bash output); re-implementing those is
  out of scope, so results are wrapped.
- Taken sites: `AssistantMessage` (reply-highlight), `PromptHint` (limit-bars, plan-progress-fx),
  `SessionMode` (plan-progress-fx), `AbovePrompt` (pokecli's band, plan-progress-fx on desktop),
  `Pane` (backlog-pane, pokecli).

## Approach

Hybrid: draw from scratch where the props carry everything (`ToolUse`, `ToolGroup`, `UserMessage`,
`TurnDuration`); wrap the engine's own drawing where they don't (`ToolResult`, `Spinner`).

Plugin: `plugins/transcript-fx` in this repo, listed in `.claude-plugin/marketplace.json`.
Command: `/fx` (`/chrome` is a built-in).

## Look

Palette: replies stay rainbow on violet (reply-highlight); tools are gold; prompts are teal.

| Token | Value | Use |
| --- | --- | --- |
| `GOLD_HI` → `GOLD_LO` | `#ffd86b` → `#c9962b` | tool edge gradient, top to bottom |
| `GOLD` | `#f5c542` | tool icon and name |
| `GOLD_TINT` | `#221d12` | behind tool results |
| `TEAL_TINT` | `#12222a` | behind the person's prompts |
| `OK` / `ERR` | `#30a46c` / `#e5484d` | ✓ / ✗ |

### Tool header (`ToolUse`, drawn)

```
▌ ✎ Write  docs/plan.md                      ✓
▌ ❯ Bash   git clone https://github.com/…    ◐
▌ ⌕ Grep   "component:" in plugins/          ✗
```

- Edge: 1 column, gold gradient (same growing-box technique as reply-highlight's edge).
- Icon by kind: edit ✎ (Write, Edit, MultiEdit, NotebookEdit), read ⌕ (Read, Glob, Grep),
  shell ❯ (Bash, PowerShell), web ◍ (WebFetch, WebSearch), agent ✦ (Agent, Task, Skill),
  MCP ⬡ (names starting `mcp__`), anything else •.
- Name: the tool name; MCP tools as `server·tool` (`mcp__claude_ai_Github_MCP__list_commits` →
  `Github_MCP·list_commits`, the `claude_ai_` prefix dropped).
- Summary (`summarize(tool, input)`), dim, truncated with `…` to the room left:
  `file_path`/`notebook_path` (relative to the session cwd when inside it), `command` first line,
  Grep `"pattern"` plus ` in <path>` when given, Glob `pattern`, `url`, `query`, `description`,
  `skill`; otherwise empty.
- Status at the right: ◐ running, ✓ done (green), ✗ errored (red), ⊘ interrupted (dim).
- A row inside an expanded group keeps the engine drawing, since it shows its result inline there.

### Tool result (`ToolResult`, wrapped)

`await next(e)` inside a row: gold gradient edge on the left, `GOLD_TINT` behind, padding 1. The
engine's tree is untouched inside.

### Folded group (`ToolGroup`, drawn when not expanded)

`▌ ⌕ Read ×3 · Grep ×2` — counts per tool in first-seen order, gold, icon of the first call's kind,
◐ while `isActive`. When `isExpanded` is true the hook passes (`next(e)`); the rows it unfolds into
are `ToolUse` rows and get the header above.

### Prompt (`UserMessage`, drawn)

Only rows whose `origin.kind` is `composer` or `bridge` (the person typing, at the terminal or
through Remote Control); notifications, scheduled triggers, peer, teammate and channel messages pass. A `TEAL_TINT` panel with the text in the terminal's colour, a dim `you` tag at
the right and a 1-column rainbow edge on the right side (violet at the top to red at the bottom,
mirroring the replies). Slash-command echoes get the panel only if the engine raises them as composer `UserMessage` rows;
the implementation checks this in a live session and does not add a separate hook for them.

### Spinner (`Spinner`, wrapped)

A row: a 10-cell bar `▰▰▰▱▱▱▱▱▱▱` whose filled cells sweep left to right, each coloured by the
rainbow at its position, then the engine's own line (`await next(e)`: word, time, tokens). The bar
is a `Raster` repainted with `$.ui.blit` on a `$.clock.every` timer (~12 fps), as plan-progress-fx
paints its bars, so frames cost no render pass. The timer only blits while a spinner is mounted.

### Turn footer (`TurnDuration`, drawn)

`✦ baked in 2m 50s · 3:42 PM` — `✦` violet, the word lower-cased and run through the rainbow,
duration formatted like the engine (`3s`, `1m 4s`, `1h 2m`), then the local time the turn ended.
Drawing may not write `$.state`, so `turn.complete` (main loop) records the end time in `lastEnd`.
A footer first drawn within 10 s of it, with a duration within 2 s of that turn's, takes that time and keeps it (module-local, per `requestId`)
across redraws; a footer first drawn later, such as one already on screen when the plugin reloads,
shows its duration with no time rather than a wrong one.

### Prompt rule (`AbovePrompt`, drawn only when empty)

`await next(e)`: if another plugin drew something, return it unchanged; otherwise one row of `─`
across the viewport width, coloured by the rainbow per cell.

## Settings

- Parts: `tools` (ToolUse, ToolResult, ToolGroup), `spinner`, `prompts`, `footer`, `rule`. All on by
  default.
- `/fx` lists each part and whether it is on. `/fx <part> on|off` changes one; anything else answers
  with the usage line and changes nothing.
- Stored in `$.store` under `settings` (across sessions) and mirrored into `$.state` (`settings`) at
  `session.start` so drawings read it and redraw when it changes.
- A part that is off passes every hook it owns straight to `next(e)`.

## Safety

- Every hook passes (`next(e)`) on a surface other than `terminal`.
- Every drawing hook catches its own errors and returns `next(e)`.
- The engine draws its own component for a tree that fails validation, so a bad tree cannot blank a
  row.
- `onScreen` and other read-only props are never rewritten (the hooks return trees, never rewritten
  props).

## State contract (`types/index.d.ts`)

```ts
export type Part = 'tools' | 'spinner' | 'prompts' | 'footer' | 'rule'
export type Settings = Record<Part, boolean>
declare module 'claude-code' {
  interface PluginState {
    'transcript-fx': { settings: Settings; lastEnd: { at: number; durationMs: number } | null }
  }
}
```

`lastEnd` is when the last main-loop turn ended and how long it ran, or null before the first.

## Layout

```
plugins/transcript-fx/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.tsx        hooks + pure helpers (exported for tests)
  hooks/register.test.tsx
  types/index.d.ts
```

Pure helpers are exported from `register.tsx`, as reply-highlight does.

## Testing

`claude plugin test plugins/transcript-fx`, with tests in `hooks/register.test.tsx`
(`claude-code/testing`).

- Helpers: `summarize` (each tool kind, cwd-relative paths, first-line commands, MCP names, unknown
  input), `iconFor`, `toolLabel`, `goldEdge(n)` (first `GOLD_HI`, last `GOLD_LO`, length n),
  `groupLine`, `fmtDuration`, `parseFx`.
- Renders: each hooked part draws its own tree on `terminal` and passes on `desktop`; a part turned
  off passes; `AbovePrompt` draws the rule only when the engine tree is empty; `UserMessage` draws
  only composer prompts; an expanded `ToolGroup` passes; the footer's time is stable across two
  mounts of one `requestId`; the spinner keeps the engine's line inside its row.
- Manual: load with hot reloading, run tools, compare against the current screenshot.

## Out of scope

- Restyling the prompt input box itself (not hookable).
- Custom drawings of tool results (diffs, Bash output).
- Desktop, VS Code and mobile surfaces.
- Themes or colour configuration beyond on/off per part.
