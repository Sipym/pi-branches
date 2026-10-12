/**
 * 父侧扩展（主会话加载）：/ask 创建分支 pane、登记表、sidecar watcher、
 * sendMessage 静默回填（design.md §3/§4/§5）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { watch } from "node:fs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { consume, readJson, type DonePayload, type DropPayload } from "./sidecar.ts";
import {
  loadRegistry, nextBranchName, saveRegistry, stateDir,
  type Registry,
} from "./registry.ts";
import { inTmux, spawnBranchPane } from "./tmux.ts";

/** shell 单引号包裹（' → '\''），问题文本安全传入 pane 命令。 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function extensionRoot(): string {
  // src/parent.ts → 扩展根目录
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function formatMerge(p: DonePayload): string {
  const head = `[分支回填 · ${p.childSessionId} · 第 ${p.deliverIndex} 段] 问题：${p.question}`;
  const instr = p.instruction ? `\n（聚焦指令：${p.instruction}）` : "";
  return `${head}${instr}\n${p.summary}`;
}

interface UiCtx {
  ui: { notify: (msg: string, level?: string) => void };
}

export function initParent(pi: ExtensionAPI): void {
  const parentSessionId = process.env.PI_SESSION_ID ?? "";
  const dir = stateDir(parentSessionId);
  const windowName = `branches-${parentSessionId.slice(0, 8)}`;
  let registry: Registry = loadRegistry(dir, parentSessionId);
  let watcherStarted = false;
  let ui: UiCtx | null = null;

  function persist(): void {
    saveRegistry(dir, registry);
  }

  function notify(msg: string, level = "info"): void {
    try {
      ui?.ui.notify(msg, level);
    } catch {
      // UI 不可用时静默（watcher 后台路径）
    }
  }

  function handleSidecars(): void {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const f of names) {
      if (f.endsWith(".done")) {
        const path = join(dir, f);
        const payload = readJson<DonePayload>(path);
        if (!payload) {
          consume(path);
          continue;
        }
        // 幂等：mergeId 已回填过则跳过（M2 将改为扫描 session entries 严格去重）
        const rec = registry.branches.find((b) => b.childSessionId === payload.childSessionId);
        if (rec && rec.lastMergeId === payload.mergeId) {
          consume(path);
          continue;
        }
        // 静默回填：sendMessage 不带 triggerTurn —— 只 append，不触发请求（§5.4）
        pi.sendMessage(
          {
            customType: "branch_merge",
            content: formatMerge(payload),
            display: true,
            details: {
              mergeId: payload.mergeId,
              question: payload.question,
              childSessionId: payload.childSessionId,
              forkEntryId: payload.forkEntryId,
              deliverIndex: payload.deliverIndex,
            },
          },
        );
        if (rec) {
          rec.status = "delivered";
          rec.deliverCount = payload.deliverIndex;
          rec.lastMergeId = payload.mergeId;
        }
        persist();
        consume(path);
        notify(`分支 ${payload.childSessionId} 已回填（第 ${payload.deliverIndex} 段）`, "success");
      } else if (f.endsWith(".drop")) {
        const path = join(dir, f);
        const payload = readJson<DropPayload>(path);
        if (payload) {
          const rec = registry.branches.find((b) => b.childSessionId === payload.childSessionId);
          if (rec) {
            rec.status = "dropped";
            persist();
          }
          notify(`分支 ${payload.childSessionId} 已放弃归档（零回填）`);
        }
        consume(path);
      }
    }
  }

  function ensureWatcher(): void {
    if (watcherStarted) return;
    watcherStarted = true;
    handleSidecars(); // 启动即扫一次：补消费主会话离线期间到达的 sidecar（孤儿路径的轻量版）
    try {
      watch(dir, { persistent: false }, () => handleSidecars());
    } catch {
      // 目录监听失败时仍可在 /branches 时手动扫描
    }
  }

  pi.on("session_start", (_event: unknown, ctx: unknown) => {
    ui = ctx as UiCtx;
    if (registry.branches.some((b) => b.status === "chatting")) ensureWatcher();
  });

  pi.registerCommand("ask", {
    description: "从当前节点 fork 一个问题分支 pane（/ask <问题>）",
    handler: async (args: string, ctx: unknown) => {
      ui = ctx as UiCtx;
      const question = args.trim();
      if (!question) {
        notify("用法：/ask <问题>", "error");
        return;
      }
      if (!parentSessionId) {
        notify("未检测到 PI_SESSION_ID（需在持久会话中运行）", "error");
        return;
      }
      if (!inTmux()) {
        notify("pi-branches 需要 tmux：请在 tmux 内运行 pi（extended-keys 配置见官方 docs/tmux.md）", "error");
        return;
      }

      const name = nextBranchName(registry);
      const childSessionId = `branch-${parentSessionId.slice(0, 8)}-${name}`;
      const sidecarBase = join(dir, childSessionId);
      let forkEntryId: string | undefined;
      try {
        const branch = (ctx as { sessionManager?: { getBranch?: () => Array<{ id?: string }> } })
          .sessionManager?.getBranch?.();
        forkEntryId = branch?.at(-1)?.id;
      } catch {
        forkEntryId = undefined;
      }

      const root = extensionRoot();
      const childCmd = [
        `PI_BRANCH_ROLE=child`,
        `PI_BRANCH_NAME=${name}`,
        `PI_BRANCH_QUESTION=${shq(question)}`,
        `PI_BRANCH_SIDECAR=${shq(sidecarBase)}`,
        `PI_BRANCH_PARENT=${parentSessionId.slice(0, 8)}`,
        `PI_BRANCH_SESSION_ID_FOR_FORK=${parentSessionId}`,
        `pi --fork ${shq(parentSessionId)}`,
        `--session-id ${shq(childSessionId)}`,
        `-n ${shq(`branch ${name}: ${question.slice(0, 40)}`)}`,
        `-ne -e ${shq(root)}`,
        `--tools read,grep,find,ls`,
      ].join(" ");

      spawnBranchPane({
        window: windowName,
        title: `Q:${question.slice(0, 30)}`,
        cwd: process.cwd(),
        command: childCmd,
      });

      registry.branches.push({
        name,
        question,
        childSessionId,
        sidecarBase,
        forkEntryId,
        createdAt: new Date().toISOString(),
        status: "chatting",
        deliverCount: 0,
      });
      persist();
      ensureWatcher();
      notify(
        `分支 ${name} 已创建 → tmux select-window -t ${windowName}（找回：pi --session ${childSessionId}）`,
        "success",
      );
    },
  });

  pi.registerCommand("branches", {
    description: "列出本会话全部分支状态",
    handler: async (_args: string, ctx: unknown) => {
      ui = ctx as UiCtx;
      handleSidecars(); // 顺手补扫
      if (registry.branches.length === 0) {
        notify("尚无分支。用 /ask <问题> 创建。");
        return;
      }
      const lines = registry.branches.map((b) =>
        `  ${b.name}  [${b.status}]  已交付 ${b.deliverCount} 段  ${b.question.slice(0, 40)}`,
      );
      notify(`pi-branches（${registry.branches.length}）：\n${lines.join("\n")}`);
    },
  });
}
