# Upstream

pi-branches adapts two proven patterns from
[HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents)
(MIT, reviewed via the `amosblomqvist/pi-interactive-subagents` tmux-only fork):

- **tmux surface layer** — a dedicated detached window with a bounded pane
  grid that never steals focus from the main window, and the
  `!!process.env.TMUX && hasCommand("tmux")` environment check.
- **Sidecar lifecycle signals** — child→parent one-way communication via
  atomic (`tmp` + `rename`) sidecar files written next to the child's session
  file (`.ask`/`.exit` there; `.done`/`.drop`/`.booted` here), consumed by a
  parent-side watcher.

Everything else — the question-branch workflow (`/ask`/`/done`/`drop`),
incremental merge units, silent merge-back via `sendMessage`, the registry,
the identity widget, and the child role dispatch — was designed and built for
pi-branches. See `docs/design.md` for the full decision log.
