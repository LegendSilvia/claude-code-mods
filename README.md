# claude-code-mods

Stylish HUD mods for the Claude Code terminal, drawn under the prompt.

![a highlighted reply with rainbow headings and bold text, and the limit rings and progress bars under the Claude Code prompt](docs/screenshot.png)


| Plugin | What it draws |
| --- | --- |
| **limit-bars** | Four braille rings, filled clockwise with the percentage inside: **context** (green → amber → red), **session** 5-hour limit (cyan → violet), **weekly** limit (pink → orange) and **Fable** weekly limit (mint → blue). A light orbits each filled arc; a ring pulses red past 80% (context) or 90% (limits). Beside them: model with its effort level (italic, shading violet → pink from low to max), workspace folder, tokens used and when the session limit resets (↻ 4:30 PM). |
| **plan-progress-fx** | Animated rainbow progress bars for multi-step tasks, with gradient titles and percentages, placed to the right of the rings. On a narrow terminal they stay collapsed until you open them with **◉ Progress**, and then take the rings' place. It also changes how Claude works so the bars stay current; see [below](#how-plan-progress-fx-steers-claude). |
| **reply-highlight** | Sets Claude's replies apart in the transcript: a rainbow edge down the left (red at the top of each block to violet at the bottom) and a violet tint behind them. Text keeps the terminal's colour; what Claude **bolds**, and headings, run through a rainbow letter by letter. Code blocks and tables keep Claude Code's own drawing inside the panel. |
| **backlog-pane** | A side pane for the project: its **git status** on top (branch, ahead/behind, changed files coloured by kind), shown in any git repository, then its [Backlog.md](https://github.com/MrLesk/Backlog.md) tasks when it has a `backlog/` folder (in its root, or a parent inside the same repository). Tasks **in progress** carry a rainbow bar of checked acceptance criteria and a **✓ done** button; the **backlog** list has **▸ start** buttons; priority, type and first label sit in front of each title; a box at the bottom creates a task. Buttons run the `backlog` CLI, so files stay as Backlog.md writes them. Rereads every few seconds; `/backlog` reopens it. |
| **transcript-fx** | Restyles the rest of the transcript to match. Tool calls are gold rows (an icon per kind, a short summary, ✓ / ✗ / ◐ / ⊘) with their results in a gold-edged panel, and folded runs are one gold count line (`Read ×3 · Grep ×2`). Your prompts sit in a teal panel with a rainbow edge on the right. A small rounded square sits beside the spinner with a rainbow comet circling its border; the spinner keeps its time and tokens. Each turn closes with `✦ baked in 2m 50s · 3:42 PM`, and a rainbow rule sits above the prompt when nothing else uses that band. `/fx` turns each part on or off. |

Each works alone; limit-bars and plan-progress-fx share the line under the prompt when both are installed.

## Install

Requires a Claude Code build with plugin hooks (`ui.render`).

```sh
claude plugin marketplace add LegendSilvia/claude-code-mods
claude plugin install limit-bars@claude-code-mods
claude plugin install plan-progress-fx@claude-code-mods
claude plugin install reply-highlight@claude-code-mods
claude plugin install backlog-pane@claude-code-mods
claude plugin install transcript-fx@claude-code-mods
```

Restart Claude Code. If you use a `statusLine` command in `settings.json` that shows the model, folder or context, you can remove it: limit-bars shows the same.

### Notes

- The rate-limit rings fill in after the first reply of a session (Claude Code learns the limits from API responses) and only on a subscription account. A limit your account doesn't report shows `--`.
- The Fable ring reads the weekly window whose name contains `fable`, or any other model-specific weekly window.
- The rings and animation need the terminal; the desktop app gets pie glyphs (`○ ◔ ◑ ◕ ●`) instead.

### plan-progress-fx commands

| Command | Does |
| --- | --- |
| `/progress` | Show or hide the bars |
| `/progress-demo` | Run a sample plan |
| `/progress-sounds` | Play the decision, error and done sounds |
| `/progress-clear` | Remove all bars |

### transcript-fx commands

| Command | Does |
| --- | --- |
| `/fx` | List the parts and whether each is on |
| `/fx <part> on\|off` | Turn one part on or off: `tools`, `spinner`, `prompts`, `footer`, `rule` (remembered across sessions) |

The footer's clock time is taken when the turn ends; footers already on screen when the plugin reloads show only their duration.

### How plan-progress-fx steers Claude

The bars only move when Claude reports progress, so this plugin changes what Claude does, not just what the terminal draws:

- **Rules in the system prompt.** Every session it adds a short section telling Claude to create a bar (through the plugin's `plan_progress` tool) for any task needing more than about three edits or commands, to update it as steps finish, and to mark it "needs input" before asking you to decide.
- **One refused call per turn.** While no bar is open, the 4th file-changing `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash` or `PowerShell` call of a turn is refused once, with a message telling Claude to create a bar first. Read-only shell calls (`ls`, `git status`, `grep`) don't count, and subagents are never refused.
- **Sent back once at the end of a turn.** If the turn did work and a bar is still open when Claude stops, Claude is sent back once to update it. A reply that ends in a question marks the bar as waiting on you instead.
- **Reminders.** With a bar open, every six changing calls without an update add a one-line reminder to the tool result, and each prompt you send carries one line naming the open bars.

## Develop

```sh
claude plugin validate plugins/limit-bars
claude plugin test plugins/limit-bars
claude plugin test plugins/plan-progress-fx
claude plugin test plugins/reply-highlight
claude plugin test plugins/backlog-pane
claude plugin test plugins/transcript-fx
```

## License

MIT. `plan-progress-fx` is a fork of [plan-progress](https://github.com/zycck/claude-mods) by Kirill Serditov (MIT); see its [LICENSE](plugins/plan-progress-fx/LICENSE).
