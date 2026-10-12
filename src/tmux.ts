/**
 * tmux 层（design.md §3.1/§3.4）：检测沿用 pi-interactive-subagents `tmux.ts:49` 先例；
 * 专用 window `branches-<parent短id>`，有界网格，永不抢主窗口焦点。
 */
import { execFileSync } from "node:child_process";

export function hasTmuxBinary(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

export function inTmux(): boolean {
  return !!process.env.TMUX && hasTmuxBinary();
}

export function tmuxOut(args: string[]): string {
  return execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function windowExists(name: string): boolean {
  try {
    return tmuxOut(["list-windows", "-F", "#{window_name}"]).split("\n").includes(name);
  } catch {
    return false;
  }
}

export interface PaneSpawn {
  window: string;
  title: string;
  cwd: string;
  /** 完整 shell 命令（含 env 前缀）。pane 退出前保活。 */
  command: string;
}

export function spawnBranchPane(spawn: PaneSpawn): void {
  const cmd = spawn.command;
  if (windowExists(spawn.window)) {
    tmuxOut([
      "split-window", "-d", "-t", spawn.window,
      `-e`, `PI_BRANCH_PANE_TITLE=${spawn.title}`,
      "--", `printf '\\033]2;%s\\033\\\\' '${spawn.title}'; ${cmd}; exec zsh`,
    ]);
    try {
      tmuxOut(["select-layout", "-t", spawn.window, "tiled"]);
    } catch {
      // 布局失败不影响功能
    }
  } else {
    // 首个分支直接以命令建窗：避免 new-window 默认自带的空 shell pane（m0-findings #1）
    tmuxOut(["new-window", "-d", "-n", spawn.window, "-c", spawn.cwd,
      `-e`, `PI_BRANCH_PANE_TITLE=${spawn.title}`,
      "--", `printf '\\033]2;%s\\033\\\\' '${spawn.title}'; ${cmd}; exec zsh`]);
  }
}
