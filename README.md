# pi-branches

**Parallel question branches for the [Pi coding agent](https://github.com/earendil-works/pi) — fork your session at any point, interrogate several questions at once in side-sessions, and merge back only the distilled conclusions.**

Reading a long agent output, you often end up with a handful of questions. Asking them inline pollutes your main context with discussion the next task doesn't need — and serial Q&A feels sluggish. pi-branches gives each question its own forked session in a parallel tmux pane: you chat in all of them at once, and each branch ends by merging back a compact summary — or nothing at all.

<video src="docs/assets/demo.mp4" autoplay loop muted playsinline width="100%"></video>
<p><sub>90-second walkthrough: three questions branched in parallel from a design discussion, two merged back, one dropped — then the main session finalizes the spec using the merged conclusions. (<a href="docs/assets/demo.mp4">mp4 link</a>)</sub></p>


```
main session ──┬── /ask q1 ──▶ ┌ branch q1 ── /done ──▶ summary ─┐
               │               │                                    ├─ silently appended
               ├── /ask q2 ──▶ ├ branch q2 ── /done focus —▶ …────┤   (zero extra requests)
               │               │                                    │
               └── /ask q3 ──▶ └ branch q3 ── /drop ──▶ ∅ (nothing)┘
```

## Why

- **Context hygiene** — the main session only ever absorbs ≤5-point summaries, never the back-and-forth. Long chats cause [context rot](https://research.trychroma.com/context-rot); branches keep your working context clean.
- **Parallel by default** — N questions run simultaneously in a dedicated tmux window. Your main session keeps working; nothing steals focus.
- **Human-driven** — unlike subagent fan-out, *you* interrogate each branch, follow-ups included. Agents answer; you steer.
- **Zero-request merges** — conclusions are appended to the transcript silently. No tokens are spent until you actually continue.
- **Safe by default** — branch sessions get a read-only tool allowlist (`read`, `grep`, `find`, `ls`) and an identity message that forbids touching the main session's files or git state.

## Install

### Prerequisites

| Requirement | Notes |
|---|---|
| [Pi coding agent](https://github.com/earendil-works/pi) ≥ 1.1.0 | See the project README for installation and model/API-key setup |
| tmux ≥ 3.2 | macOS: `brew install tmux` · Debian/Ubuntu: `apt install tmux` |
| Pi **running inside tmux** | pi-branches opens branch panes through your tmux session; outside tmux `/ask` fails fast with a clear error |

Recommended tmux config — lets Pi distinguish `Shift+Enter` / `Ctrl+Enter` from plain `Enter` (tmux ≥ 3.5):

```tmux
# ~/.tmux.conf
set -g extended-keys on
set -g extended-keys-format csi-u
```

On tmux 3.2–3.4 use only `set -g extended-keys on`. Restart the tmux server after changing it (`tmux kill-server` saves nothing — close sessions first). Details: [Run Pi in tmux](https://github.com/earendil-works/pi/blob/main/docs/tmux.md).

### Install

```bash
pi install git:github.com/<user>/pi-branches
```

Verify with `pi list` (should show `pi-branches`), then start a new Pi session — `/branches` responds even with zero branches. A local/dev checkout works the same way:

```bash
git clone https://github.com/<user>/pi-branches && pi install ./pi-branches
```

Update and remove:

```bash
pi update --extensions      # reconcile to the configured ref
pi remove git:github.com/<user>/pi-branches
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| `/ask` → "pi-branches requires tmux" | Start tmux first (`tmux new -s work`), run `pi` inside it |
| `/ask` → "Main session has no persisted content yet" | Send at least one message in the main session first — branches fork from persisted history |
| Branch pane closed too soon | `pi --session branch-<shortid>-q<N>` resumes it; `/branches` lists all session ids |
| Keys like `Shift+Enter` behave like `Enter` | Apply the `extended-keys` config above and restart the tmux server |

## Quick start (30 seconds)

1. At any point in a session: `/ask Why does the cache key hash the request body?`
2. Switch to the branches window (tmux `prefix + '`), and the branch is already answering — its identity message was injected automatically.
3. Ask follow-ups like a normal session.
4. End the branch:
   - `/done` — merge a ≤5-point summary back (silently)
   - `/done focus on the backoff schedule` — shape what gets merged
   - `/drop` — for questions you only needed answered for yourself: zero backfill
5. Back in the main session, the conclusions are already in your transcript. Continue working.

## Commands

| Command | Where | What it does |
|---|---|---|
| `/ask [--compact\|--turns N] <question>` | main | Fork a read-only branch pane at the current node (full history by default; `--compact` = zero retained turns, `--turns N` = keep last N turns — use these when the session discusses pi-branches itself) |
| `/done [focus instruction]` | branch | Deliver an incremental merge; the instruction shapes the summary |
| `/drop [reason]` | branch | End with zero backfill (Q&A-style branches) |
| `/branches` | main | List all branches: `chatting / delivered / dropped` |

Branch sessions can deliver **multiple segments**: keep chatting after `/done` and deliver again.

## How it works

Each branch is a real `pi --fork` of your session — full context at the fork point, its own session file (`parentSession` linked). When you run `/done`, the branch runs a final summarization turn, writes an atomic sidecar file (`.done`, with a `mergeId` for idempotence), and closes. A watcher in the parent extension picks it up and calls `sendMessage` **without** `triggerTurn`: the summary is appended to the current leaf of the main transcript — cherry-pick semantics, no request fired, safe even if you've moved on or switched branches.

Read the full design — lifecycle state machine, sidecar protocol, and the 14-entry decision log — in [`docs/design.md`](docs/design.md) (in Chinese; English summary above).

## Compared to alternatives

- **Subagent fan-out** (`pi-interactive-subagents`, Claude Code subagents): agent-driven children for autonomous tasks. pi-branches is the complement — *you* converse, for questions that deserve human steering. Use both.
- **Chat branching trees** (LibreChat forking, Msty): UI-level branching for chat products. pi-branches is coding-agent native: real processes in tmux panes, tool allowlists, git-safety rules, and merge-back designed for working sessions.

## Limitations (roadmap)

- Branches inherit the default model; a `--model` flag for cheap branch models is planned
- Branch writes are deliberately restricted (read-only allowlist); an explicit `--write` escape hatch is planned

## Acknowledgments

The tmux surface pattern and the sidecar lifecycle design are adapted from [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents) (MIT) — thank you.

## License

MIT
