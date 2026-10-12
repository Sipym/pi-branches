/**
 * tmux layer (design.md §3.1/§3.4): detection follows the pi-interactive-subagents
 * `tmux.ts:49` precedent; a dedicated window `branches-<parent short id>` with a
 * bounded grid that never steals focus from the main window.
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
  /** Full shell command (with env prefix). The pane stays alive after exit. */
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
      // layout failure is non-fatal
    }
  } else {
    // First branch creates the window with the command directly: avoids the default empty shell pane (m0-findings #1)
    tmuxOut(["new-window", "-d", "-n", spawn.window, "-c", spawn.cwd,
      `-e`, `PI_BRANCH_PANE_TITLE=${spawn.title}`,
      "--", `printf '\\033]2;%s\\033\\\\' '${spawn.title}'; ${cmd}; exec zsh`]);
  }
}
