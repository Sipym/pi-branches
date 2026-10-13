# pi-branches — Demo Recording Script (lean edition)

**Goal:** a 60–90s hero GIF for the README.
**Story:** you read an agent's output, three questions pop up, you open three parallel branch sessions, interrogate one of them, merge back two distilled conclusions, drop the third — and the main session immediately puts those conclusions to work in the final spec. The main context stays clean throughout.

---

## Pre-record setup (~2 min, NOT recorded)

1. **Fresh demo project + seed the main session**

   ```bash
   tmux kill-session -t demo 2>/dev/null
   mkdir -p ~/demo-pi-branches && cd ~/demo-pi-branches
   tmux new -s demo
   pi -n "fetchq walkthrough"
   ```

   Seed prompt (deliberately lightweight — ~30s, no code, but contains exactly three askable things: cache key, backoff schedule, TTL):

   > Design the caching strategy for a small CLI tool `fetchq` in under 150 words: cover the cache key, 429 retry backoff, and --ttl semantics. No code.

   Let it finish, then **detach with `Ctrl-b d`** (the process stays alive; the frame freezes on the output).

2. **Check your environment** — `pi list` shows `pi-branches`; terminal ≥ 120×34, clean theme.

---

## Recording

From a **plain terminal window outside tmux**:

```bash
cd ~/demo-pi-branches
asciinema rec -c "tmux attach -t demo" demo.cast
```

### Storyboard

| # | Time | Action | Expected screen |
|---|------|--------|-----------------|
| 0 | 0:00–0:04 | Idle on the main session; the caching-strategy output visible | freeze 2s so viewers can read |
| 1 | 0:04–0:14 | `/ask Why does the cache key hash the request body?` ⏎ — wait for `Branch q1 created` — then `/ask Walk me through the 429 retry — what's the backoff schedule?` ⏎ and `/ask What does --ttl actually control?` ⏎ | three creation notices, 1–2s apart |
| 2 | 0:14–0:24 | `Ctrl-b '` → the `branches-*` window; optional: `Ctrl+Alt+O` once to flash the expanded widget docs, then collapse | 3 panes already answering; identity widget visible |
| 3 | 0:24–0:40 | Switch to the **q2** pane (`Ctrl-b o` / arrows), shortest possible follow-up: `Why not fixed delay?` ⏎ — wait — `/done focus on the backoff schedule` ⏎ | `Generating merge summary…` → `Merged back (deliver 1). Closing pane…` |
| 4 | 0:40–0:48 | **q1** pane: `/done` ⏎ (default summary). **q3** pane: `/drop` ⏎ | q1 merges & closes; q3 closes with `Dropped (zero backfill)` |
| 5 | 0:48–1:00 | `Ctrl-b w` back to the main window | two `[branch merge · branch-…-q1/q2]` entries sitting quietly in the transcript; optional closing beat: `/branches` showing `delivered · delivered · dropped` |

Then exit: `/exit` in pi → `exit` in tmux → recording stops automatically.

**Pacing:** leave 1–2s of stillness between beats — `--idle-time-limit` compresses anything longer, and agent-generation waits vanish on their own. Type at a natural pace; no captions needed (every command, notice, and merge entry is already on screen, and the README text carries the narrative).

---

## After recording

**Convert:**

```bash
agg --idle-time-limit 2.0 --font-size 22 demo.cast demo.gif
open demo.gif && ls -lh demo.gif
```

If it exceeds ~10MB, re-run with `--idle-time-limit 1.5 --speed 1.1`.

**Four command screenshots** — replay and pause (no need to grab them live):

```bash
asciinema play demo.cast   # Space = pause/resume
```

Pause at each key moment and `Cmd+Shift+4` it:

1. `cmd-ask.png` — `/ask` notices + branches window
2. `cmd-done.png` — `/done focus …` and the `Merged back` notice
3. `cmd-drop.png` — `/drop` and the `Dropped` notice
4. `cmd-branches.png` — the `/branches` status list

**Deliverables** → `docs/assets/`: `demo.gif` (60–90s, ≥1100px wide) + the four PNGs.
