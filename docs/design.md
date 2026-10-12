# pi-branches 设计文档

- 版本：v0.5（回填可选化与定制化，待实现）
- 日期：2026-02-14
- 分支：`feat/pi-branches`（基线 `b764f19`；迁独立仓库后以新仓库为准）
- 状态：设计定稿；实现从路线 M0 开始
- 目标形态：开发期驻留 `~/.pi` 仓库（`agent/extensions/pi-branches`）自用打磨；成熟后拆出独立开源仓库，以 Pi Package（npm/git 双源）发布

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

文件：`.done`（回填交付）与 `.drop`（免回填归档，仅含 childSessionId 与时间戳），另有 `.exit` 记录异常退出。

```json
{
  "mergeId": "uuid-v4",
  "question": "创建分支时的原始问题",
  "forkEntryId": "fork 点 entryId",
  "childSessionId": "branch-q1",
  "deliverIndex": 2,
  "instruction": "用户提供的回填聚焦指令（空 = 通用摘要）",
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
| `/ask --join <问题1> <问题2> …` | 父 | 一条命令开一组 barrier：组内全部分支 done 后合并成一条消息唤醒一次（见下） |
| `/done [聚焦指令]` | 子 | 交付一段增量；聚焦指令作为总结 prompt 的核心（空 = 通用摘要）（见 §4） |
| `/drop [原因]` | 子 | 免回填结束：答疑型分支直接归档，零主线消息 |
| `/branches` | 父 | 列出全部分支状态，支持清理/打开归档 |
| `/branches --flush <group>` | 父 | 手动放行 barrier：已到齐部分合并唤醒，未完成剔除并注明 |

**barrier 模式细节（`--join`）**：

- 组定义：一条命令开一组（组名 `join-<ts>`），登记表内分支带 `group` 字段；组建议 2–5 个分支。
- 子侧无感知：照常 `/done`/sidecar/关 pane；barrier 逻辑全在父侧 watcher——发现分支带 `group` 则摘要暂存登记表（pending-join），不立即回填。
- 到齐触发：组内全部 delivered（含 pane 死亡经兜底总结的）→ 合并为一条 `branch_merge` 消息，`triggerTurn: true` 唤醒恰一次。
- content 模板：首行亮明 barrier 语义（“问题组 <group> 已全部完成（N/N）”）；每段以**问题原文为标题** + 摘要正文；结尾行为指令——“需要行动请直接继续；均无影响则一句话确认即可，不必逐条回应”。
- details：`{ mode:"join", group, forkEntryId, branches:[{mergeId, question, childSessionId, deliverIndex}], flushed }`；幂等键 = 组内 mergeId 集合；`flushed:true` 标记手动放行。
- 异常：不做自动超时；`--flush` 手动放行（未完成剔除注明）；`--wake` 与 `--join` 互斥；等待期主会话退出由孤儿扫描路径覆盖。
- 适用：结论需**合在一起看**的批量问题（如多方案可行性调研综合决策）；彼此独立的结论用默认静默。

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
   ├── /drop ──▶ dropped（归档，零主线消息）
   └── pane 关闭/进程退出──▶ exited ──有增量且无 .drop？──▶ 父侧兜底总结
```

### 3.5 分支身份与防遗忘引导

三层标识，让分支 pane 从视觉到模型自知都可辨识（沿用于 interactive-subagents 的 widget 先例）：

1. **常驻身份 widget（child 扩展，编辑器上方；定稿方案 B，经可视化预览选定）**：主题框（圆角细边框）折叠态单行——`⎇ 分支 q1 · 属 pi分叉与合并 (01a1251d) · 已交付 N 段` + 虚线脚注快捷键提示；`Ctrl+Alt+O` 展开 = **内置使用文档**：`/done [聚焦指令]`（含示例：`/done 以"为何否掉 A 方案"为核心总结`）、`/drop [原因]`（免回填归档）、当前状态、归档找回命令。**默认折叠；首次进入分支自动展开一次（教学），之后记住用户偏好**（偏好持久化于扩展 state 目录，原子写）。文档内容随命令面演进同步维护。预览参考：`~/Projects/pi-visual/pi-branches-widget`。
2. **首条定位消息（fork 时自动注入，三合一）**：**身份**（你是主会话 X 在节点 Y 分出的分支，只讨论：`<问题>`）+ **行为边界**（不主动修改主会话管辖的文件与仓库状态；实验性改动仅限临时验证且**不得 commit**，改动留工作区并随 `.done` 的 filesTouched 上报；不自行回填/总结，等结束指令）+ **结束协议**（`/done [聚焦指令]` 回填 / `/drop` 免回填）。——模型侧身份自觉与权限边界，治痛点 #4、#5。
3. **命名与 pane 标识**：tmux window `branches-<短id>`、pane title `Q:问题缩写`、会话名 `branch-<短id>-<q>`；session 文件头 `parentSession` 链接（M0 已验证存在）。

`/done` 流程（子侧）：

1. 注入最后一条 user message：默认为“把自上次回填以来关于 `<问题>` 的结论压缩成 ≤N 条自包含要点”；若 `/done` 带聚焦指令，则以用户指令为核心组织（如“以‘为何否掉 A 方案’为核心总结”），回填物形态随之自由：决策记录、清单、主题结论皆可，不限于通用摘要；
2. agent 完成最后一轮，末条 assistant message 即摘要（无需扩展直调 LLM）；
3. 原子写 `.done`（含 mergeId）；
4. **关闭 pane**，登记表归档 session 路径（session 文件永久保留，`pi --session <id>` 可找回）。

兜底（父侧）：watcher 发现 pane 死亡且无 `.done`/`.drop` 但有未交付增量 → 发一条消息让主 agent 读子 session 文件自行总结并决定是否纳入（此路径必然唤醒，因为需要主 agent 干活）；见 `.drop` 则静默归档，零消息。

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
| 10 | 发布形态：Pi Package（npm+git 双源、MIT、上游致谢、零本机私有扩展依赖） | 开源可用性与合规优先；走生态标准安装路径 |
| 11 | 开发节奏：先在 `~/.pi` 自用打磨（M0-M4），成熟后拆出独立仓库发布（M5） | 尽早验证真实使用价值；拆出前零发布负担，拆出时历史可完整迁移 |
| 12 | 结束二元化：`/done [聚焦指令]` 回填（指令可定制回填物形态）+ `/drop` 免回填归档；决定点在结束时而非 `/ask` 时 | 答疑型分支本就不该回填；聊完才知道要不要留、以什么视角留 |
| 13 | 防遗忘三件套：主题框身份 widget（方案 B：默认折叠 + 首次教学 + 记忆偏好）+ 首条定位消息 + 命名约定 | 分支 pane 与普通会话视觉无区分、忘记 /done /drop 用法、子 pi 无身份自觉（痛点 #4）都直接损害可用性；文档 in place 优于查 README；经三方案可视化对比选定 |
| 14 | 提交权在主会话：分支可实验性写文件但不主动 commit，改动留工作区 + filesTouched 留痕，集成/提交由主会话审查后决定 | q1 越权案例（痛点 #5）：分支带完整上下文易"自当主会话"；讨论产出（回填）与代码产出（提交）必须分离，否则分支会污染主线 git 历史 |

补充约束：回填消息用 customType `branch_merge`，`content` 进模型上下文，结构化字段（mergeId、forkEntryId 等）放 `details`，配 entry renderer 做折叠渲染。

## 6. 边界情况

1. **幂等/崩溃恢复**：父侧消费 `.done` 前，按 `mergeId` 检查主 session 是否已有同 id 的 entry（存于 details），有则跳过；"append 成功但 sidecar 未删"的中间态由此天然去重。
2. **孤儿分支**：主会话先退出 → `.done` 无人消费。主会话下次 `session_start` 时扫登记表，发现未消费 `.done` 则提示"N 条分支结论待回填"。
3. **主会话 `/tree` 切分支或 `/fork`**：回填目标永远是消费时刻的 active session 当前 leaf（见 §5.4）。
4. **主会话正忙**：静默回填走 `sendMessage` 默认路径（空闲=仅 append；agent 运行中=轮末 append），不注入当前轮、不额外烧请求。
5. **pane 堆积**：done/drop 即关（§5.5）；`/branches` 提供 `chatting / 待回填 / 已回填 / 已放弃 / 孤儿` 总览与清理。

## 7. 非目标（v1）

- 自动 fan-out（问题自动交给 subagent 答）——那是 pi-interactive-subagents 的职责，本扩展只编排人驱动的分支；未来可做 `/ask --auto` 转发。
- 跨机器/远程 pane；摘要质量自动评估；树状 UI 可视化（`/tree` 已有）。
- 分支内再嵌套 `/ask`（技术上可行，v1 禁用以控复杂度）。

## 8. 发布与分发

开发期驻留 `~/.pi` 仓库（`agent/extensions/pi-branches`，走本仓库扩展流程）自用打磨；成熟后按 §10 路线 M5 拆出独立开源仓库，以 **Pi Package** 形态发布：

- 分发通道：npm 包 + git repo 双源（`pi install npm:@<scope>/pi-branches` / `pi install git:github.com/<user>/pi-branches`）；npm 侧加 `pi-package` keyword 进入官方 package gallery。
- manifest：`package.json` 声明 `pi` 资源字段；host 提供的 `@earendil-works/*` 与 `typebox` 一律 `peerDependencies: "*"`，不打进 tarball。
- License：MIT。上游致谢：tmux 表面层与 sidecar 生命周期模式源自 `HazAT/pi-interactive-subagents`（MIT，经 amosblomqvist fork），随仓库附 UPSTREAM 记录复用范围。
- 依赖约束：**零本机私有扩展依赖**（command-gate、pi-files-touched 等不进依赖面）；文件留痕等能力内置轻量实现。
- 兼容声明：明确支持的 pi 版本范围（参考上游 "for Pi 0.84.3" 做法），CI 固定版本矩阵跑 integration 测试。
- 命名检查：发布前核对 npm 与 GitHub 的 `pi-branches` 名称占用，冲突则换名。

## 9. 测试策略

沿用 `pi-interactive-subagents/test` 的 integration 模式：独立进程起父子会话、真实 tmux、fake/低成本模型；重点用例：多分支并发回填顺序、mergeId 幂等、孤儿恢复、非 tmux 环境 `/ask` 报错路径、`/done` 无增量幂等提示、`/drop` 零消息归档、`/done <聚焦指令>` 回填物形态、`--write` 分支内置文件留痕。

## 10. 路线

| 里程碑 | 内容 | 验证标准 |
|---|---|---|
| **M0 手工验证** | 零代码：shell alias + `pi --fork` + 手动 tmux 开窗，跑通"提问→讨论→摘要→贴回" | 体验假设成立；产出痛点清单反哺设计 |
| **M1 核心闭环** | `/ask`（只读、单 window 网格、tmux 检测）→ `/done`（子侧总结+sidecar）→ 父侧静默回填 + 最小 widget | 3 个问题并行，全部静默落入主会话 transcript |
| **M2 健壮性** | mergeId 幂等、登记表持久化、孤儿启动恢复、`/branches` 列表与清理 | 崩溃重启 / 主会话先退 / 手滑多次 `/done` 三类注入测试 |
| ~~M3 增强~~ **降级为需求触发池（2026-10-12 自用复盘）** | 池内：`--wake`（静默+手动继续已覆盖）、`--join` barrier（低频，设计已细化备查）、`--write`+留痕（答疑型使用不需要）；多段交付 M1 已实现。真实场景出现再启动，原则：痛点驱动，不预设计 | — |
| **M4 自用收尾** | branch_merge 折叠渲染、`--model <轻量模型>`（入口成本调节器，自 M3 并入）、双语 README（README.md + README.zh-CN.md）、持久启用（✅ 2026-10-12 已 pi install 本地源） | 真实使用一周无阻塞 |
| **M5 拆出发布** | 拆出独立仓库（保留历史，如 subtree split）；package.json `pi` 声明、npm+git 双源、CI 版本矩阵、gallery 提交；`~/.pi` 改为 `pi install` 引用 | `pi install npm:`/`git:` 全链路可用；上游致谢与命名检查完成 |

M1 步骤 0：先读 `agent/extensions/AGENTS.md` 与 `MAINTAINING.md`，依赖安装与脚本一律走 pnpm workspace（`agent/` 根），不新增扩展级 lockfile。
