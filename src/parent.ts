/**
 * Parent-side extension (loaded by the main session): /ask spawns branch panes,
 * a registry, the sidecar watcher, and silent merge-back via sendMessage
 * (design.md §3/§4/§5).
 *
 * The session id comes from ctx.sessionManager.getSessionId() — the pi process
 * itself has no PI_SESSION_ID env (that env is only injected into tool subprocesses).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { consume, readJson, type DonePayload, type DropPayload } from "./sidecar.ts";
import {
  loadRegistry, nextBranchName, saveRegistry, stateDir,
  type Registry,
} from "./registry.ts";
import { inTmux, spawnBranchPane } from "./tmux.ts";

/** Shell single-quote wrapping (' → '\'') so question text survives the pane command. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function extensionRoot(): string {
  // src/parent.ts → extension root
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function formatMerge(p: DonePayload): string {
  const head = `[branch merge · ${p.childSessionId} · deliver ${p.deliverIndex}] Question: ${p.question}`;
  const instr = p.instruction ? `\n(focus: ${p.instruction})` : "";
  return `${head}${instr}\n${p.summary}`;
}

interface SessionCtx {
  ui: { notify: (msg: string, level?: string) => void };
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string;
    getLeafId?: () => string | null;
  };
  model?: { provider?: string; id?: string; input?: string[] };
}

export function initParent(pi: ExtensionAPI): void {
  let parentSessionId = "";
  let dir = "";
  let windowName = "";
  let registry: Registry | null = null;
  let watcherStarted = false;
  let ui: { notify: (msg: string, level?: string) => void } | null = null;

  function readSid(ctx: unknown): string {
    const sid = (ctx as SessionCtx | undefined)?.sessionManager?.getSessionId?.();
    return sid || process.env.PI_SESSION_ID || "";
  }

  /** Lazy init: load registry and paths once we have a session id. Returns readiness. */
  function ensureInit(ctx: unknown): boolean {
    ui = (ctx as SessionCtx | undefined)?.ui ?? ui;
    const sid = readSid(ctx);
    if (!sid) return false;
    if (sid !== parentSessionId) {
      parentSessionId = sid;
      dir = stateDir(sid);
      windowName = `branches-${sid.slice(0, 8)}`;
      registry = loadRegistry(dir, sid);
    }
    return true;
  }

  function persist(): void {
    if (dir && registry) saveRegistry(dir, registry);
  }

  function notify(msg: string, level = "info"): void {
    try {
      ui?.notify(msg, level);
    } catch {
      // UI unavailable (background watcher path) — stay silent
    }
  }

  function handleSidecars(): void {
    if (!dir || !registry) return;
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
        // Idempotence: skip mergeIds already delivered (M2: strict dedupe by scanning session entries)
        const rec = registry.branches.find((b) => b.childSessionId === payload.childSessionId);
        if (rec && rec.lastMergeId === payload.mergeId) {
          consume(path);
          continue;
        }
        // Silent merge-back: sendMessage without triggerTurn — append only, no request (§5.4)
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
        notify(`Branch ${payload.childSessionId} merged back (deliver ${payload.deliverIndex})`, "success");
      } else if (f.endsWith(".drop")) {
        const path = join(dir, f);
        const payload = readJson<DropPayload>(path);
        if (payload) {
          const rec = registry.branches.find((b) => b.childSessionId === payload.childSessionId);
          if (rec) {
            rec.status = "dropped";
            persist();
          }
          notify(`Branch ${payload.childSessionId} dropped (zero backfill)`);
        }
        consume(path);
      }
    }
  }

  function ensureWatcher(): void {
    if (watcherStarted || !dir) return;
    watcherStarted = true;
    handleSidecars(); // initial scan: consume sidecars that arrived while the session was offline
    try {
      watch(dir, { persistent: false }, () => handleSidecars());
    } catch {
      // Directory watching failed; /branches still scans on demand
    }
  }

  pi.on("session_start", (_event: unknown, ctx: unknown) => {
    if (ensureInit(ctx)) {
      if (registry && registry.branches.some((b) => b.status === "chatting")) ensureWatcher();
    }
  });

  pi.registerCommand("ask", {
    description: "Fork a question branch pane from the current node (/ask <question>)",
    handler: async (args: string, ctx: unknown) => {
      if (!ensureInit(ctx)) {
        notify("Could not resolve the current session id (sessionManager.getSessionId unavailable)", "error");
        return;
      }
      const question = args.trim();
      if (!question) {
        notify("Usage: /ask <question>", "error");
        return;
      }
      if (!inTmux()) {
        notify("pi-branches requires tmux: run pi inside tmux (see extended-keys setup in the official docs/tmux.md)", "error");
        return;
      }

      const name = nextBranchName(registry!);
      const childSessionId = `branch-${parentSessionId.slice(0, 8)}-${name}`;
      const sidecarBase = join(dir, childSessionId);
      let forkEntryId: string | undefined;
      try {
        forkEntryId = (ctx as SessionCtx).sessionManager?.getLeafId?.() ?? undefined;
      } catch {
        forkEntryId = undefined;
      }
      // Fork source = parent session file path (more robust than id lookup); clear error when nothing is persisted yet
      const parentFile = (ctx as SessionCtx).sessionManager?.getSessionFile?.();
      if (!parentFile || !existsSync(parentFile)) {
        notify("Main session has no persisted content yet: send a message first, then /ask", "error");
        return;
      }

      const root = extensionRoot();
      // Pin the parent's current model: fork copies the full context (including
      // image blocks). Without an explicit --model the child's fuzzy resolution
      // may land on a text-only variant and 400 on multimodal content (finding #6).
      let modelArg = "";
      try {
        const m = (ctx as SessionCtx).model;
        if (m?.id) modelArg = `--model ${shq(m.provider ? `${m.provider}/${m.id}` : m.id)}`;
      } catch {
        modelArg = "";
      }
      const childCmd = [
        `PI_BRANCH_ROLE=child`,
        `PI_BRANCH_NAME=${name}`,
        `PI_BRANCH_QUESTION=${shq(question)}`,
        `PI_BRANCH_SIDECAR=${shq(sidecarBase)}`,
        `PI_BRANCH_PARENT=${parentSessionId.slice(0, 8)}`,
        `pi --fork ${shq(parentFile)}`,
        `--session-id ${shq(childSessionId)}`,
        `-n ${shq(`branch ${name}: ${question.slice(0, 40)}`)}`,
        `-ne -e ${shq(root)}`,
        `--tools read,grep,find,ls`,
        ...(modelArg ? [modelArg] : []),
      ].join(" ");

      spawnBranchPane({
        window: windowName,
        title: `Q:${question.slice(0, 30)}`,
        cwd: process.cwd(),
        command: childCmd,
      });

      registry!.branches.push({
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
        `Branch ${name} created → tmux select-window -t ${windowName} (resume: pi --session ${childSessionId})`,
        "success",
      );
    },
  });

  pi.registerCommand("branches", {
    description: "List all branches of this session",
    handler: async (_args: string, ctx: unknown) => {
      if (!ensureInit(ctx)) {
        notify("No session context yet.", "error");
        return;
      }
      handleSidecars(); // opportunistic rescan
      if (!registry || registry.branches.length === 0) {
        notify("No branches yet. Create one with /ask <question>.");
        return;
      }
      const lines = registry.branches.map((b) =>
        `  ${b.name}  [${b.status}]  delivered ${b.deliverCount}  ${b.question.slice(0, 40)}`,
      );
      notify(`pi-branches (${registry.branches.length}):\n${lines.join("\n")}`);
    },
  });
}
