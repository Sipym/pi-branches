# pi-branches 设计文档

- 版本：v0.1（机制闭环，待实现）
- 日期：2026-02-14
- 分支：`feat/pi-branches`（基线 `b764f19`）
- 状态：设计定稿；实现从路线 M0 开始

## 1. 背景与目标

在主会话的某个节点读完输出后，用户常会产出一批彼此独立的问题。若在主会话里逐个追问，多轮讨论会污染主线上下文，影响后续工作质量；串行追问的体感也不佳。

**目标**：在主会话任意节点，fork 出多个并行的、用户亲自驱动的"问题分支会话"；每个分支讨论完毕后，将压缩摘要回填进主会话，主线只吸收结论、不吸收过程。

社区现状（调研结论，2026-02）：聊天产品侧有分支树（LibreChat Open Forking、Msty、Dust branching），编码 agent 侧有 subagent fan-out（隔离+蒸馏回流，但子会话由 agent 驱动），二者交集——"同节点 fork + 用户交互 + 摘要回流"——无现成实现。pi 已具备全部底层积木（树形 session、`/fork`、branch summary、`sendMessage` 静默追加），本扩展只做编排。

与 `pi-interactive-subagents` 的关系：大量复用其先例（tmux 层模式、sidecar 协议、状态 widget、生命周期事件），但驱动主体不同——subagent 是 agent 自治，分支是**人亲自对话**；因此不能沿用其 `agent_settled` 自动退出，结束信号改为显式 `/done`。

## 2. 概念模型

| 术语 | 定义 |
|---|---|
| 主会话 | 用户正在工作的 pi 会话，回填的目标 |
| 分支会话 | 经 `pi --fork` 从主会话创建的独立交互会话；上下文 = fork 点全量 active branch + 问题 |
| fork point | 创建分支时主会话的 leaf entryId；仅作回填出处标注，回填永远落在消费时刻的当前 leaf |
| merge unit | 自上次回填以来的分支对话增量；每次 `/done` 交付一段 |
| 登记表 | 父侧扩展的持久化状态文件，记录全部分支及其状态 |

## 3. 架构

### 3.1 进程拓扑

```
主 pi 进程（父侧扩展）                tmux
┌─────────────────────────┐      ┌──────────────────────────┐
│ /ask 命令 ──创建──▶ tmux 窗口 branches-<parentSid>        │
│ 登记表 state/<sid>.json │      │ ┌pane q1┐┌pane q2┐┌pane q3┐│
│ watcher ◀──.done sidecar│      │ │子pi进程││子pi进程││子pi进程││
│ sendMessage 静默回填     │      │ │child扩展││child扩展││child扩展││
└─────────────────────────┘      │ └──.done┘└────────┘└────────┘│
                                 └──────────────────────────┘
```

- 同一会话的所有问题 pane 集中在一个专用 detached window（`branches-<parentSid>`），有界网格（≤2 行 × 4 列，满则新 window），永不抢占主窗口焦点——完全沿用 pi-interactive-subagents 的 tmux 层模式。
- 子进程绝不上写主会话文件；父进程绝不写子会话文件。跨进程只经 sidecar 单向传信号。

### 3.2 sidecar 协议

文件：`<childSessionFile>.done`（另有 `.exit` 记录异常退出）。

```json
{
  "mergeId": "uuid-v4",
  "question": "创建分支时的原始问题",
  "forkEntryId": "fork 点 entryId",
  "childSessionId": "branch-q1",
  "deliverIndex": 2,
  "summary": "≤N 条要点的自包含结论",
  "filesTouched": []
}
```

- 原子写：先 `<file>.<pid>.<ts>.tmp` 再 `rename()`。
- `mergeId` 供父侧幂等去重（见 §6.1）。

### 3.3 命令面

| 命令 | 侧 | 行为 |
|---|---|---|
| `/ask <问题>` | 父 | tmux 检测 → 创建只读分支 pane，登记 |
| `/ask --write <问题>` | 父 | 同上但开放写工具（见 §5.6） |
| `/ask --wake <问题>` | 父 | 创建标记为唤醒式回填的分支 |
| `/ask --join`（或多问聚合） | 父 | barrier：全部分支 done 后合并唤醒一次 |
| `/done [要点]` | 子 | 交付一段增量（见 §4） |
| `/branches` | 父 | 列出全部分支状态，支持清理/打开归档 |

### 3.4 运行环境检测（tmux 前置条件）

`/ask` 依赖 tmux 开 pane。检测沿用 `tmux.ts:49` 先例：

```ts
const inTmux = !!process.env.TMUX && hasCommand("tmux");
```

- 不满足时 `/ask` 返回明确错误信息（"pi-branches requires tmux"）+ 引导（在 tmux 内运行 pi；参见官方 docs/tmux.md 的 extended-keys 配置），**不抛未捕获异常、不降级到不可用的替代路径**。
- `session_start` 时即可探测并置扩展状态位；widget 在非 tmux 环境显示一行提示，避免用户到使用 `/ask` 时才发现。
- 依赖 `$TMUX_PANE` 识别所属 tmux session，作为 branches window 的归属锚点（同 interactive-subagents 的 root pane 逻辑）。

## 4. 分支生命周期状态机

```
chatting ──/done──▶ delivered ──继续打字──▶ chatting(+增量) ──/done──▶ delivered …
   │                                   （每段增量独立交付，可多段）
   └── pane 关闭/进程退出──▶ exited ──有未交付增量？──▶ 父侧兜底总结
```

`/done` 流程（子侧）：

1. 注入最后一条 user message："把自上次回填以来关于 `<问题>` 的结论压缩成 ≤N 条自包含要点"；
2. agent 完成最后一轮，末条 assistant message 即摘要（无需扩展直调 LLM）；
3. 原子写 `.done`（含 mergeId）；
4. **关闭 pane**，登记表归档 session 路径（session 文件永久保留，`pi --session <id>` 可找回）。

兜底（父侧）：watcher 发现 pane 死亡且无 `.done` 但有未交付增量 → 发一条消息让主 agent 读子 session 文件自行总结并决定是否纳入（此路径必然唤醒，因为需要主 agent 干活）。

## 5. Decision Log

| # | 决策 | 理由 |
|---|---|---|
| 1 | 结束信号：显式 `/done` 为主，进程退出兜底 | 人驱动的会话不能 `agent_settled` 自动关（interactive-subagents 模式不适用） |
| 2 | 压缩在子侧：`/done` 触发最后一轮总结 | 复用正常请求，扩展无需直调 LLM API |
| 3 | 跨进程只经 sidecar，tmp+rename 原子写 | 双进程写同一 JSONL 必然竞态；pi 进程独占自己的 session 文件 |
| 4 | 回填 = `sendMessage` 静默 append 到当前 leaf，`forkEntryId` 仅作出处 | cherry-pick 语义：内容产自旧节点，落在当前 HEAD；主会话前进/切分支均无冲突 |
| 5 | `/done` = 交付增量；幂等；done 即关 pane、留归档 | 多段交付是真实需求；手滑 `/done` 无新内容时提示不动；活 pane 是维护负担，文件记录不是 |
| 6 | 工具面默认只读，`--write` 显式逃逸 | 多分支 + 主会话共享 cwd，防写冲突；口子显式可审计；写过的分支回填时附 files-touched 留痕 |
| 7 | 并发安全靠 append-only + 父侧 watcher 单事件循环串行 | 无需锁；`.done` 按完成顺序排队消费 |
| 8 | 多 pane 单 window 网格，永不抢焦点 | 沿用 interactive-subagents 已验证的 tmux 层 |
| 9 | tmux 前置检测：`$TMUX` + tmux 可执行，缺则明确报错+引导 | 避免运行时报错/静默失败；session_start 即探测并提示 |

补充约束：回填消息用 customType `branch_merge`，`content` 进模型上下文，结构化字段（mergeId、forkEntryId 等）放 `details`，配 entry renderer 做折叠渲染。

## 6. 边界情况

1. **幂等/崩溃恢复**：父侧消费 `.done` 前，按 `mergeId` 检查主 session 是否已有同 id 的 entry（存于 details），有则跳过；"append 成功但 sidecar 未删"的中间态由此天然去重。
2. **孤儿分支**：主会话先退出 → `.done` 无人消费。主会话下次 `session_start` 时扫登记表，发现未消费 `.done` 则提示"N 条分支结论待回填"。
3. **主会话 `/tree` 切分支或 `/fork`**：回填目标永远是消费时刻的 active session 当前 leaf（见 §5.4）。
4. **主会话正忙**：静默回填走 `sendMessage` 默认路径（空闲=仅 append；agent 运行中=轮末 append），不注入当前轮、不额外烧请求。
5. **pane 堆积**：done 即关（§5.5）；`/branches` 提供 `chatting / 待回填 / 已回填 / 孤儿` 总览与清理。

## 7. 非目标（v1）

- 自动 fan-out（问题自动交给 subagent 答）——那是 pi-interactive-subagents 的职责，本扩展只编排人驱动的分支；未来可做 `/ask --auto` 转发。
- 跨机器/远程 pane；摘要质量自动评估；树状 UI 可视化（`/tree` 已有）。
- 分支内再嵌套 `/ask`（技术上可行，v1 禁用以控复杂度）。

## 8. 测试策略

沿用 `pi-interactive-subagents/test` 的 integration 模式：独立进程起父子会话、真实 tmux、fake/低成本模型；重点用例：多分支并发回填顺序、mergeId 幂等、孤儿恢复、非 tmux 环境 `/ask` 报错路径、`/done` 无增量幂等提示、`--write` 分支 files-touched 留痕。

## 9. 路线

| 里程碑 | 内容 | 验证标准 |
|---|---|---|
| **M0 手工验证** | 零代码：shell alias + `pi --fork` + 手动 tmux 开窗，跑通"提问→讨论→摘要→贴回" | 体验假设成立；产出痛点清单反哺设计 |
| **M1 核心闭环** | `/ask`（只读、单 window 网格、tmux 检测）→ `/done`（子侧总结+sidecar）→ 父侧静默回填 + 最小 widget | 3 个问题并行，全部静默落入主会话 transcript |
| **M2 健壮性** | mergeId 幂等、登记表持久化、孤儿启动恢复、`/branches` 列表与清理 | 崩溃重启 / 主会话先退 / 手滑多次 `/done` 三类注入测试 |
| **M3 增强** | `--wake` / `--join` barrier、`--write` + files-touched 集成、多段增量交付 | 对应 flag 行为测试 |
| **M4 收尾** | 渲染打磨、README、按需加载进运行环境（需用户授权） | 真实使用一周无阻塞 |

M1 步骤 0：先读 `agent/extensions/AGENTS.md` 与 `MAINTAINING.md`，依赖安装与脚本一律走 pnpm workspace（`agent/` 根），不新增扩展级 lockfile。
