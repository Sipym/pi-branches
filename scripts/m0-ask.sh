#!/usr/bin/env bash
# M0 手工验证: 从当前 pi 会话 fork 一个"问题分支" pane
# 用法: m0-ask.sh "问题" [短id]
# 前置: 在 tmux 内运行的 pi 会话的 bash 工具中调用 (依赖 $PI_SESSION_ID / $TMUX)
set -euo pipefail

question="${1:?用法: m0-ask.sh \"问题\" [短id]}"
id="${2:-q$(date +%H%M%S)}"

# --- tmux 前置检测 (design.md §3.4) ---
if [[ -z "${TMUX:-}" ]] || ! command -v tmux >/dev/null 2>&1; then
  echo "错误: pi-branches 需要 tmux (请在 tmux 内运行 pi 后调用)" >&2
  exit 1
fi
# --- 会话来源: 优先环境变量, 允许手动传参覆盖 ---
parent="${PI_SESSION_ID:-}"
if [[ -z "$parent" ]]; then
  echo "错误: 未检测到 PI_SESSION_ID (在 pi 的 bash 工具内运行, 或 export PI_SESSION_ID=<会话ID>)" >&2
  exit 1
fi

pshort="${parent:0:8}"
window="branches-${pshort}"
sid="m0-${pshort}-${id}"

# --- 同一会话的问题 pane 集中在一个专用 window, 不抢主窗口焦点 (design §3.1) ---
tmux list-windows -F '#{window_name}' | grep -qx "$window" || tmux new-window -d -n "$window"
tmux split-window -d -t "$window" \
  "printf '\033]2;%s\033\\' 'Q:${question:0:30}'; pi --fork '${parent}' --session-id '${sid}' -n 'M0 ${id}: ${question:0:40}'; exec zsh"
tmux select-layout -t "$window" tiled >/dev/null 2>&1 || true

echo "✓ 分支 ${sid} 已创建"
echo "  窗口: ${window}  (切换: tmux select-window -t ${window} 或 prefix+')"
echo "  归档找回: pi --session ${sid}"
