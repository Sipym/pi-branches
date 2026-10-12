/**
 * 子侧扩展（分支会话加载）：身份 widget（方案 B）、首条定位消息（三合一，幂等）、
 * /done 交付增量、/drop 免回填归档（design.md §3.5/§4/§5）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { randomUUID } from "node:crypto";
import { isBooted, markBooted, writeDone, writeDrop } from "./sidecar.ts";

interface WidgetCtx {
  ui: { setWidget: (id: string, render: (tui: unknown, theme: unknown) => unknown, opts: { placement: string }) => void };
}
interface CmdCtx extends WidgetCtx {
  shutdown: () => void;
  ui: WidgetCtx["ui"] & { notify: (msg: string, level?: string) => void };
}

/** theme 防御包装：theme 不可用时原样返回。 */
function fg(theme: unknown, key: string, text: string): string {
  const t = theme as Record<string, ((k: string, s: string) => string) | undefined> | null;
  try {
    return t?.fg ? t.fg(key, text) : text;
  } catch {
    return text;
  }
}

function assistantText(messages: unknown): string {
  const arr = Array.isArray(messages) ? messages : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i] as { role?: string; content?: Array<{ type?: string; text?: string }> };
    if (m?.role !== "assistant") continue;
    const text = (m.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
    return text || "（无文本输出）";
  }
  return "（无 assistant 输出）";
}

export function initChild(pi: ExtensionAPI): void {
  const name = process.env.PI_BRANCH_NAME ?? "";
  const question = process.env.PI_BRANCH_QUESTION ?? "";
  const sidecarBase = process.env.PI_BRANCH_SIDECAR ?? "";
  const parentShort = process.env.PI_BRANCH_PARENT ?? "主会话";
  const valid = !!sidecarBase && !!name;

  let expanded = false;
  let deliverPending: string | null = null;
  let deliverCount = 0;
  let lastMessages: unknown;

  function renderWidget(ctx: WidgetCtx): void {
    ctx.ui.setWidget(
      "pi-branches-identity",
      (_tui: unknown, theme: unknown) => {
        const box = new Box(1, 0);
        const head =
          fg(theme, "accent", `⎇ 分支 ${name}`) +
          fg(theme, "muted", ` · 属 ${parentShort}`) +
          fg(theme, "dim", ` · 已交付 ${deliverCount} 段`);
        if (!expanded) {
          const hint = fg(theme, "dim", `  (Ctrl+Alt+O 展开 · /done 回填 · /drop 放弃)`);
          box.addChild(new Text(head + hint, 0, 0));
        } else {
          box.addChild(new Text(head, 0, 0));
          const docs = [
            `${fg(theme, "toolTitle", "/done [聚焦指令]")}  交付增量回填主会话；指令决定回填物形态`,
            `${fg(theme, "toolTitle", "/drop  [原因]")}     免回填归档，零主线消息（答疑型分支）`,
            `${fg(theme, "dim", "示例")} /done 以"为何否掉 A 方案"为核心总结`,
            `${fg(theme, "dim", "找回")} pi --session ${process.env.PI_SESSION_ID ?? ""}`,
          ].join("\n");
          box.addChild(new Text(docs, 0, 0));
        }
        return box;
      },
      { placement: "aboveEditor" },
    );
  }

  pi.on("session_start", (_event: unknown, ctx: unknown) => {
    renderWidget(ctx as WidgetCtx);
    // 首条定位消息（三合一：身份+行为边界+结束协议），.booted 标记幂等
    if (valid && question && !isBooted(sidecarBase)) {
      markBooted(sidecarBase);
      const boot = [
        `[分支定位] 你是主会话（${parentShort}）分出的分支会话 ${name}，只讨论下面这个问题：`,
        question,
        `行为边界：不主动修改主会话管辖的文件与仓库状态（不得 commit）；实验性改动仅限临时验证并留工作区；不自行总结回填，等 /done 或 /drop 指令。`,
        `请开始回答上述问题。`,
      ].join("\n");
      setTimeout(() => {
        try {
          pi.sendUserMessage(boot);
        } catch {
          // 注入失败不影响手动使用
        }
      }, 300);
    }
  });

  pi.registerShortcut("ctrl+alt+o", {
    description: "展开/折叠分支身份 widget",
    handler: (ctx: unknown) => {
      expanded = !expanded;
      renderWidget(ctx as WidgetCtx);
    },
  });

  pi.registerCommand("done", {
    description: "交付一段增量回填主会话（/done [聚焦指令]）",
    handler: async (args: string, ctx: unknown) => {
      const c = ctx as CmdCtx;
      if (!valid) {
        c.ui.notify("不在分支会话环境（缺少 PI_BRANCH_SIDECAR）", "error");
        return;
      }
      deliverPending = args.trim() || null;
      const focus = deliverPending ? `以「${deliverPending}」为核心组织。` : "";
      const prompt = [
        `请把自上次回填以来关于「${question}」的讨论，压缩成 ≤5 条自包含要点，面向主会话读者（它知道设计背景，但不知道本分支的新讨论）。${focus}`,
        `只输出本分支新产生的结论，不要重述主会话已知内容。这是本分支的收尾输出，将直接回填主会话。`,
      ].join("\n");
      c.ui.notify("正在生成本段回填摘要…", "info");
      try {
        await pi.sendUserMessage(prompt);
      } catch (e) {
        deliverPending = null;
        c.ui.notify(`发送总结指令失败：${String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("drop", {
    description: "免回填结束本分支（答疑型分支，零主线消息）",
    handler: async (args: string, ctx: unknown) => {
      const c = ctx as CmdCtx;
      if (!valid) {
        c.ui.notify("不在分支会话环境（缺少 PI_BRANCH_SIDECAR）", "error");
        return;
      }
      writeDrop(sidecarBase, {
        childSessionId: process.env.PI_SESSION_ID ?? `branch-${name}`,
        reason: args.trim() || undefined,
        at: new Date().toISOString(),
      });
      c.ui.notify("已放弃归档（零回填），pane 即将关闭", "info");
      setTimeout(() => c.shutdown(), 500);
    },
  });

  pi.on("agent_end", (event: unknown) => {
    lastMessages = (event as { messages?: unknown }).messages;
  });

  pi.on("agent_settled", (_event: unknown, ctx: unknown) => {
    if (!deliverPending || !valid) return;
    const summary = assistantText(lastMessages);
    deliverCount += 1;
    const instruction = deliverPending;
    deliverPending = null;
    writeDone(sidecarBase, {
      mergeId: randomUUID(),
      question,
      childSessionId: process.env.PI_SESSION_ID ?? `branch-${name}`,
      deliverIndex: deliverCount,
      instruction: instruction || undefined,
      summary,
      filesTouched: [],
    });
    const c = ctx as CmdCtx;
    c.ui.notify(`已回填（第 ${deliverCount} 段），pane 即将关闭`, "success");
    setTimeout(() => c.shutdown(), 800);
  });
}
