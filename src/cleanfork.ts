/**
 * Clean fork (design.md finding #6): `pi --fork` rebuilds context from the
 * session file verbatim — persisted `thinking` blocks (and `image` blocks)
 * end up in the request `content` array, which text-only request paths on
 * some providers reject with 400 code 1210 ("content.type 允许 ['text']").
 *
 * The parent therefore materializes a sanitized copy of its own session file
 * and the child opens it with `pi --session <path>`:
 *   - `thinking` blocks are stripped (they never belong in model context)
 *   - `image` blocks become a `[image omitted]` text placeholder (branches
 *     are discussion sessions; this also shrinks the entry-context cost)
 *   - assistant messages left empty after stripping are dropped
 */
import { mkdirSync } from "node:fs";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

interface ContentBlock {
  type?: string;
  text?: string;
  [k: string]: unknown;
}

interface Entry {
  type?: string;
  id?: string;
  message?: { role?: string; content?: ContentBlock[] };
  [k: string]: unknown;
}

export interface CleanForkResult {
  path: string;
  entries: number;
  thinkingStripped: number;
  imagesReplaced: number;
  emptyAssistantDropped: number;
}

export function writeCleanFork(
  parentSessionFile: string,
  childSessionId: string,
  keepTurns = 0, // retained recent dialog turns; -1 keeps the full history (--deep)
): CleanForkResult {
  const lines = readFileSync(parentSessionFile, "utf8").split("\n").filter(Boolean);
  const out: Entry[] = [];
  let thinkingStripped = 0;
  let imagesReplaced = 0;
  let emptyAssistantDropped = 0;

  for (const line of lines) {
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue; // tolerate a torn tail line from the live parent process
    }
    if (e.type === "session") {
      out.push({ ...e, id: childSessionId });
      continue;
    }
    const m = e.message;
    if (m && Array.isArray(m.content)) {
      const next: ContentBlock[] = [];
      for (const b of m.content) {
        if (b.type === "thinking") {
          thinkingStripped += 1;
        } else if (b.type === "image") {
          imagesReplaced += 1;
          next.push({ type: "text", text: "[image omitted]" });
        } else {
          next.push(b);
        }
      }
      if (next.length === 0) {
        if (m.role === "assistant") {
          emptyAssistantDropped += 1;
          continue;
        }
        next.push({ type: "text", text: "(empty)" });
      }
      out.push({ ...e, message: { ...m, content: next } });
      continue;
    }
    out.push(e);
  }

  // Compaction graft (finding #8, final form): the branch should look like an
  // ordinary session that just ran /compact — recent turns kept verbatim,
  // everything older replaced by a short archive note. No identity claims
  // anywhere: "branch" is for humans (widget), the model only gets behavior
  // instructions in the first user message.
  if (keepTurns >= 0) {
    // Locate the start of the k-th user turn from the tail (a "turn" = one
    // user message + its assistant/tool chain).
    let firstKeptId = "";
    if (keepTurns > 0) {
      let seen = 0;
      for (let i = out.length - 1; i >= 0; i--) {
        const e = out[i] as { type?: string; id?: string; message?: { role?: string } };
        if (e.type === "message" && e.message?.role === "user") {
          seen++;
          if (seen >= keepTurns) { firstKeptId = String(e.id ?? ""); break; }
        }
      }
    }
    const tokensBefore = Math.round(
      out.reduce((n, e) => n + JSON.stringify(e).length, 0) / 4,
    );
    const compactionId = randomBytes(4).toString("hex");
    const parentId = out.length ? String(out[out.length - 1].id ?? "") : "";
    out.push({
      type: "compaction",
      id: compactionId,
      parentId,
      timestamp: new Date().toISOString(),
      summary: [
        "Earlier history compacted for focus when this session was created.",
        `The full archived conversation remains available verbatim in the parent session file: ${parentSessionFile}`,
        "If you need details not present in the retained recent turns, use the read tool on that file.",
      ].join("\n"),
      firstKeptEntryId: firstKeptId || compactionId, // fallback: retain-none
      tokensBefore,
      fromHook: true,
    });
  }

  const dst = join(dirname(parentSessionFile), `${childSessionId}.jsonl`);
  mkdirSync(dirname(dst), { recursive: true });
  const tmp = `${dst}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, out.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  renameSync(tmp, dst); // atomic: the child never sees a partial file

  return {
    path: dst,
    entries: out.length,
    thinkingStripped,
    imagesReplaced,
    emptyAssistantDropped,
  };
}
