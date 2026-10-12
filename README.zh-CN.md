# pi-branches（中文说明）

**[Pi coding agent](https://github.com/earendil-works/pi) 的并行问题分支扩展——在会话任意节点 fork，多个问题在并行侧会话中同时追问，只把提炼后的结论合并回主线。**

读一段很长的 agent 输出时，你常会冒出一堆问题。在主会话里逐个追问，会把下个任务用不到的讨论塞进主线上下文（context rot），串行问答的体感也差。pi-branches 给每个问题一个 fork 出来的独立会话（并行 tmux pane）：你可以同时跟所有分支对话，每个分支结束时把压缩摘要静默合并回来——或者什么都不合并。

## 为什么需要

- **上下文卫生**：主会话只吸收 ≤5 条要点的摘要，从不吸收讨论过程
- **默认并行**：N 个问题同时跑在专用 tmux 窗口，主会话继续干活、焦点不被抢
- **人驱动**：不同于 subagent 扇出（agent 自治），分支由*你*亲自多轮追问
- **零请求回填**：结论静默 append 进 transcript，你继续工作前不烧任何 token
- **默认安全**：分支会话只有只读工具白名单（`read/grep/find/ls`），首条身份消息明确禁止改动主会话文件与 git 状态

## 安装

### 前置环境

| 要求 | 说明 |
|---|---|
| [Pi coding agent](https://github.com/earendil-works/pi) ≥ 1.1.0 | 安装与模型/API key 配置见其项目 README |
| tmux ≥ 3.2 | macOS: `brew install tmux` · Debian/Ubuntu: `apt install tmux` |
| Pi **运行在 tmux 内** | 分支 pane 通过 tmux 创建；不在 tmux 内时 `/ask` 会明确报错 |

建议的 tmux 配置——让 Pi 区分 `Shift+Enter` / `Ctrl+Enter` 与普通 `Enter`（tmux ≥ 3.5）：

```tmux
# ~/.tmux.conf
set -g extended-keys on
set -g extended-keys-format csi-u
```

tmux 3.2–3.4 只需 `set -g extended-keys on`；改完需重启 tmux server。详见 [Run Pi in tmux](https://github.com/earendil-works/pi/blob/main/docs/tmux.md)。

### 安装与验证

```bash
pi install git:github.com/<user>/pi-branches
```

`pi list` 应显示 `pi-branches`；新开一个 Pi 会话，`/branches` 能响应即安装成功。本地/开发安装同理：

```bash
git clone https://github.com/<user>/pi-branches && pi install ./pi-branches
```

更新与卸载：

```bash
pi update --extensions
pi remove git:github.com/<user>/pi-branches
```

### 常见问题

| 现象 | 处理 |
|---|---|
| `/ask` 报 "pi-branches requires tmux" | 先 `tmux new -s work` 再在其中运行 pi |
| `/ask` 报 "Main session has no persisted content yet" | 先在主会话发至少一条消息（分支从已落盘历史 fork） |
| 分支 pane 误关 | `pi --session branch-<短id>-q<N>` 可续聊；`/branches` 列出全部 id |
| `Shift+Enter` 表现同 `Enter` | 按上文配置 `extended-keys` 并重启 tmux server |

## 快速上手

1. 会话任意处：`/ask 为什么缓存键要哈希请求体？`
2. 切到 branches 窗口（tmux `prefix + '`）——分支已在回答（身份消息自动注入）
3. 像普通会话一样追问
4. 结束分支：`/done`（默认摘要回填）· `/done 以××为核心总结`（定制回填）· `/drop`（答疑型，零回填）
5. 回主会话，结论已在 transcript 里，继续工作

## 命令

| 命令 | 位置 | 作用 |
|---|---|---|
| `/ask <问题>` | 主会话 | 从当前节点 fork 一个只读分支 pane |
| `/done [聚焦指令]` | 分支 | 交付一段增量回填；指令决定回填物形态 |
| `/drop [原因]` | 分支 | 免回填结束（答疑型分支） |
| `/branches` | 主会话 | 列出全部分支状态 |

`/done` 后可继续追问、再次 `/done`（多段增量交付）。

## 工作原理

分支是对当前会话的真实 `pi --fork`（带全量上下文与 `parentSession` 谱系）。`/done` 触发最后一轮总结，原子写 sidecar（`.done`，含幂等 `mergeId`）后关 pane；父侧 watcher 消费后以不带 `triggerTurn` 的 `sendMessage` 把摘要 append 到主会话当前 leaf——cherry-pick 语义、零请求、主会话切分支也安全。

完整设计（生命周期状态机、sidecar 协议、14 条决策日志）见 [`docs/design.md`](docs/design.md)。

## 致谢

tmux 表面层与 sidecar 生命周期模式改编自 [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents)（MIT）。

## 许可

MIT
