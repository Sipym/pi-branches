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
