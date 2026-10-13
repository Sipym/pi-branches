# M0 痛点清单（试用过程中持续更新）

| # | 步骤 | 痛点 | 严重度 | 对设计的影响 | 状态 |
|---|---|---|---|---|---|
| 1 | 开分支 | `new-window` 默认自带空 shell pane，窗口里多一个无用 zsh | 中 | 正式版首个分支必须"带命令建窗"；已在 m0-ask.sh 修复验证 | 已修 |
| 2 | 结束/清理 | smoke/演示 pane 无自动回收，需要手动 kill-window；用户感知为"怎么没关掉" | 高 | 印证 Decision #5（`/done` 即关 pane）与孤儿回收设计的必要性；M0 阶段约定：演示完立即手动清理 | 设计已覆盖 |
| 3 | 总结指令 | 分支零增量时发总结指令，"本次讨论"语义歧义：子 pi 把 fork 带来的主会话历史当"本次讨论"重述了一遍 | 高 | 印证 `/done` 的 deliverIndex/增量锚点设计的必要性；且暴露新要求：**回填物应是分支新增量结论，而非主线已知内容的重述**（那份重述对主会话零信息增益）——正式版总结指令须限定"自上次回填以来的新对话" | 设计已覆盖+新增注记 |
| 4 | 分支身份 | 子会话无身份自觉：q1 的 pi 把自己当主会话延续，评论用户"贴错了地方" | 中 | 印证 child 扩展身份 widget + 首条定位消息（"你是从节点 X 分出的问题分支"）的必要性 | 设计已覆盖 |
| 5 | 写权限/提交权 | q1 带完整上下文+完整工具面，自作主张修改设计文档并 commit（fa14e4d）——分支越过了主会话的管辖权 | 高 | 印证 Decision #6（默认只读）；暴露新维度：**提交权/认领协议**——分支实验性写文件可以，但不主动 commit，改动留工作区+filesTouched 留痕，集成决定权在主会话；首条定位消息须含行为边界（见 Decision #14） | 新增 Decision #14 |
| 6 | fork 与内容类型 | 从含 thinking/image 块的主会话 fork，`pi --fork` 原样重放文件 → 持久化块进入请求 content → 400 code 1210（"取值范围 ['text']"）；首诊误判为模型 fuzzy 落到 flash，锁模型无效（实证复现仍 400），真因为 thinking 块 | 高 | 根因修复：父侧生成清洗副本（剥 thinking、image→`[image omitted]` 占位、删空 assistant），子进程 `pi --session` 直接打开；`--model` 锁定保留为二道防线。附带发现：分支会被上下文末尾未完话题带偏，身份消息需加强（待改）。实证：169 thinking+2 image 会话清洗后正常多轮 | 已修（根因） |
| 7 | 参数互斥回归 | 清洗 fork 改用 `pi --session <file>` 后保留了 `--session-id`/`-n`（二者互为别名），pi 明确拒绝组合（"--session-id cannot be combined with --session"）→ 子进程启动即退、pane 只剩 zsh，任何 /ask 全灭 | 高 | 清洗路径下 id 已写入副本文件 session entry，两个命名参数全删；完整链路复现验证（多行+引号 question → 身份注入 → 模型回合成功）| 已修 |
| 8 | 偏题：分支不答题、诊断消息来源 | 触发面实验证明为 **dogfooding 自指特异**：历史含注入模板文本时模型认出"我刚写的代码"→诊断（t2/t3/t5，pi-branches 开发会话）；**普通项目全量历史完全正常**（G1：R2E-V 会话 fork，零工具直接深度作答） | 高 | 机制：缝合压缩（手写存档说明+read 兜底）+ 无身份声明首消息模板；**默认值经 G1 验证翻转为全量历史**，`--compact`/`--turns N` 为截断选项（自指场景用 --compact） | 已修 |
| 9 | registry 状态不更新（chatting 卡死、幂等失效） | child 的 `childSessionId` 用 `process.env.PI_SESSION_ID`（pi 进程自身无此变量，findings 早已记录该事实）fallback 为 `branch-<name>`，与 registry 的 `branch-<parent>-<name>` 不匹配 → find 找不到 rec，状态更新与 lastMergeId 幂等静默失效（M1 遗留：当时只验证了 branch_merge 出现，未查 registry 字段） | 高 | `resolveChildId`：优先 `ctx.sessionManager.getSessionId()`（resume 场景也可靠，顺带解决 env 丢失），env/name 兜底。彩排 q3 闭环验证 delivered ✓ | 已修 |
