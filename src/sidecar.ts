/**
 * Sidecar protocol (design.md §3.2): cross-process signals travel one way
 * through sidecar files. Children write .done/.drop; the parent-side watcher
 * consumes them. Writes are atomic via tmp + rename.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DonePayload {
  mergeId: string;
  question: string;
  forkEntryId?: string;
  childSessionId: string;
  deliverIndex: number;
  instruction?: string;
  summary: string;
  filesTouched: string[];
}

export interface DropPayload {
  childSessionId: string;
  reason?: string;
  at: string;
}

function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

export function writeDone(sidecarBase: string, payload: DonePayload): void {
  atomicWrite(`${sidecarBase}.done`, JSON.stringify(payload));
}

export function writeDrop(sidecarBase: string, payload: DropPayload): void {
  atomicWrite(`${sidecarBase}.drop`, JSON.stringify(payload));
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Consume = rename to .consumed: audit trail, prevents watcher double-firing. */
export function consume(path: string): void {
  try {
    renameSync(path, `${path}.consumed`);
  } catch {
    // already consumed or gone — idempotent
  }
}

/** Idempotence marker for the first identity-message injection (survives restarts/resume). */
export function markBooted(sidecarBase: string): void {
  atomicWrite(`${sidecarBase}.booted`, new Date().toISOString());
}

export function isBooted(sidecarBase: string): boolean {
  try {
    readFileSync(`${sidecarBase}.booted`, "utf8");
    return true;
  } catch {
    return false;
  }
}
