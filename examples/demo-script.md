# pi-branches — Demo Recording Script

**Goal:** produce a 60–90s GIF (README hero) or a 2–3 min walkthrough video.
**Story:** you read an agent's output, three questions pop up, you open three parallel branch sessions, discuss them independently, merge back two distilled conclusions, and drop the third — your main context stays clean.

---

## Pre-record setup (~5 min, do once before hitting record)

1. **Fresh demo project**

   ```bash
   mkdir -p ~/demo-pi-branches && cd ~/demo-pi-branches
   tmux new -s demo
   ```

2. **Seed the main session** (run this *before* recording, so the agent output is already on screen):

   > Design a small Python CLI utility `fetchq` that fetches a JSON API with a local file cache, retries on 429 with exponential backoff, and supports a `--ttl` flag. Give me the implementation plan first, then the code.

   Let it finish. You now have output containing at least three askable things: the cache key, the backoff schedule, and the TTL semantics.

3. **Check your environment**

   - `pi list` shows `pi-branches` installed
   - Running inside tmux (`echo $TMUX` non-empty)
   - Terminal ≥ 120×34, a clean theme, font size comfortable on video

---

## Storyboard

| # | Time | Action | Expected screen | Caption (overlay text) |
|---|------|--------|-----------------|------------------------|
| 0 | 0:00–0:05 | Idle on the main session; agent's `fetchq` output visible | transcript with the implementation | "Reading agent output… and three questions come up." |
| 1 | 0:05–0:15 | Type `/ask Why does the cache key hash the request body?` ⏎ then `/ask Walk me through the 429 retry — what's the backoff schedule?` ⏎ then `/ask What does --ttl actually control?` ⏎ | three success notices: `分支 q1/q2/q3 已创建 → tmux select-window -t branches-…` | "Three questions → three parallel branches. No context pollution." |
| 2 | 0:15–0:30 | `prefix + '` → select the `branches-*` window | 3 panes, each already answering its question (identity message was injected automatically); point briefly at the widget line `⎇ 分支 q1 · 属 … · 已交付 0 段` | "Each branch forks the full context — and already knows what the main session knows." |
| 3 | 0:30–0:50 | In **q2**, type a follow-up: `Why exponential and not fixed delay?` ⏎ — wait for the answer — then `/done focus on why exponential backoff is preferred` ⏎ | notify `正在生成本段回填摘要…` → `已回填（第 1 段），pane 即将关闭` | "Multi-turn discussion, then deliver a focused summary. `/done [instruction]` shapes what gets merged back." |
| 4 | 0:50–1:00 | In **q1**: `/done` ⏎ (default summary). In **q3**: `/drop` ⏎ | q1 delivers and closes; q3 closes with `已放弃归档（零回填）` | "Answered for myself only? `/drop` it — the main session never sees it." |
| 5 | 1:00–1:15 | `prefix + w` back to the main session window | transcript quietly contains two `[分支回填 · branch-…-q1/q2]` entries; no new agent turn fired | "Two distilled conclusions, silently appended. Zero extra requests." |
| 6 | 1:15–1:30 | Type: `Based on the branch conclusions, rewrite the retry section of the plan.` ⏎ | agent answers using the merged knowledge without re-deriving it | "The main session just… knows. Context stays clean, work continues." |

Optional closing beat: run `/branches` to flash the status list (`q1 delivered · q2 delivered · q3 dropped`).

---

## Recording tips

- **GIF tools:** [vhs](https://github.com/charmbracelet/vhs) (scriptable, reproducible) or `terminalizer`/`asciinema` + `agg`. For a hero GIF, keep it ≤ 90s and ≥ 1000px wide.
- Slow your typing slightly; captions carry the story.
- Trim waiting time (agent turns) with a quick cut — don't make viewers watch generation.
- The notice text is currently Chinese (`已创建/已回填/已放弃`); for the video you can either leave it (authentic) or we add an i18n pass before recording — decide before you record.

## After recording

- `docs/assets/demo.gif` (or `.mp4` + poster frame) — referenced from both READMEs.
- Screenshot set for the Commands section: one frame per command (`/ask`, `/done`, `/drop`, `/branches`).
