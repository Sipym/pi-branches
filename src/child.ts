/**
 * Child-side extension (loaded inside branch sessions): identity widget (option B),
 * the first identity message (three-in-one, idempotent), /done incremental merge,
 * /drop zero-backfill archive (design.md §3.5/§4/§5).
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
  sessionManager?: { getSessionId?: () => string };
}

/** Resolve this branch's real session id (findings #9): PI_SESSION_ID is only
 *  injected into tool subprocesses, never the pi process itself — the old
 *  fallback `branch-<name>` mismatched the registry's branch-<parent>-<name>,
 *  so status updates/idempotence silently no-op'd. getSessionId also survives
 *  resume, which spawn-time env vars do not. */
function resolveChildId(ctx: unknown, name: string): string {
  try {
    const sm = (ctx as CmdCtx).sessionManager;
    const id = sm?.getSessionId?.();
    if (id) return id;
  } catch {
    // fall through
  }
  return process.env.PI_SESSION_ID ?? `branch-${name}`;
}

/** Defensive theme wrapper: return text unchanged when theme is unavailable. */
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
    return text || "(no text output)";
  }
  return "(no assistant output)";
}

export function initChild(pi: ExtensionAPI): void {
  const name = process.env.PI_BRANCH_NAME ?? "";
  const question = process.env.PI_BRANCH_QUESTION ?? "";
  const sidecarBase = process.env.PI_BRANCH_SIDECAR ?? "";
  const parentShort = process.env.PI_BRANCH_PARENT ?? "main session";
  const valid = !!sidecarBase && !!name;

  let expanded = false;
  let deliverArmed = false; // /done armed, waiting for settle to persist (separate from focus: bare /done still delivers)
  let deliverInstruction = "";
  let deliverCount = 0;
  let lastMessages: unknown;

  function renderWidget(ctx: WidgetCtx): void {
    ctx.ui.setWidget(
      "pi-branches-identity",
      (_tui: unknown, theme: unknown) => {
        const box = new Box(1, 0);
        const head =
          fg(theme, "accent", `⎇ branch ${name}`) +
          fg(theme, "muted", ` · of ${parentShort}`) +
          fg(theme, "dim", ` · delivered ${deliverCount}`);
        if (!expanded) {
          const hint = fg(theme, "dim", `  (Ctrl+Alt+O expand · /done merge · /drop discard)`);
          box.addChild(new Text(head + hint, 0, 0));
        } else {
          box.addChild(new Text(head, 0, 0));
          const docs = [
            `${fg(theme, "toolTitle", "/done [focus]")}  deliver an incremental merge to the main session; the focus instruction shapes the summary`,
            `${fg(theme, "toolTitle", "/drop  [reason]")}  end with zero backfill (for Q&A-style branches)`,
            `${fg(theme, "dim", "e.g.")} /done focus on why option A was rejected`,
            `${fg(theme, "dim", "resume")} pi --session ${process.env.PI_SESSION_ID ?? ""}`,
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
    // First message (pause + question-only instruction), idempotent via .booted marker
    if (valid && question && !isBooted(sidecarBase)) {
      markBooted(sidecarBase);
      // First-message template (finding #8, final): a plain user instruction —
      // no branch/identity/archive vocabulary at all. "Branch" is for humans
      // (widget); the model only gets behavior constraints. Off-branch evidence:
      // identity declarations themselves triggered the "mispasted message"
      // rationalization and the diagnostic detour (q1/t1/t2).
      const boot = [
        `Let's pause the previous work — please don't continue any unfinished tasks, diagnostics, or pending threads from the conversation above.`,
        ``,
        `I just want to discuss a question:`,
        ``,
        question,
        ``,
        `Answer it directly. Discussion only: no file changes, no git operations, no summaries or status reports. I'll follow up or wrap up myself.`,
      ].join("\n");
      setTimeout(() => {
        try {
          pi.sendUserMessage(boot);
        } catch {
          // injection failure is non-fatal; manual use still works
        }
      }, 300);
    }
  });

  pi.registerShortcut("ctrl+alt+o", {
    description: "Expand/collapse the branch identity widget",
    handler: (ctx: unknown) => {
      expanded = !expanded;
      renderWidget(ctx as WidgetCtx);
    },
  });

  pi.registerCommand("done", {
    description: "Deliver an incremental merge to the main session (/done [focus instruction])",
    handler: async (args: string, ctx: unknown) => {
      const c = ctx as CmdCtx;
      if (!valid) {
        c.ui.notify("Not in a branch session (PI_BRANCH_SIDECAR missing)", "error");
        return;
      }
      deliverArmed = true;
      deliverInstruction = args.trim();
      const focus = deliverInstruction ? `Organize the summary around: "${deliverInstruction}".` : "";
      const prompt = [
        `Compress the discussion since the last merge about "${question}" into at most 5 self-contained bullet points, written for the main session's reader (it knows the project background but not this branch's new discussion). ${focus}`,
        `Output only conclusions NEW to this branch — do not restate what the main session already knows. This is the closing output of this branch and will be merged back directly.`,
      ].join("\n");
      c.ui.notify("Generating merge summary…", "info");
      try {
        await pi.sendUserMessage(prompt);
      } catch (e) {
        deliverArmed = false;
        c.ui.notify(`Failed to send summary prompt: ${String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("drop", {
    description: "End this branch with zero backfill (Q&A-style, no main-session message)",
    handler: async (args: string, ctx: unknown) => {
      const c = ctx as CmdCtx;
      if (!valid) {
        c.ui.notify("Not in a branch session (PI_BRANCH_SIDECAR missing)", "error");
        return;
      }
      writeDrop(sidecarBase, {
        childSessionId: resolveChildId(ctx, name),
        reason: args.trim() || undefined,
        at: new Date().toISOString(),
      });
      c.ui.notify("Dropped (zero backfill). Closing pane…", "info");
      setTimeout(() => c.shutdown(), 500);
    },
  });

  pi.on("agent_end", (event: unknown) => {
    lastMessages = (event as { messages?: unknown }).messages;
  });

  pi.on("agent_settled", (_event: unknown, ctx: unknown) => {
    if (!deliverArmed || !valid) return;
    const summary = assistantText(lastMessages);
    deliverCount += 1;
    const instruction = deliverInstruction;
    deliverArmed = false;
    deliverInstruction = "";
    writeDone(sidecarBase, {
      mergeId: randomUUID(),
      question,
      childSessionId: resolveChildId(ctx, name),
      deliverIndex: deliverCount,
      instruction: instruction || undefined,
      summary,
      filesTouched: [],
    });
    const c = ctx as CmdCtx;
    c.ui.notify(`Merged back (deliver ${deliverCount}). Closing pane…`, "success");
    setTimeout(() => c.shutdown(), 800);
  });
}
