/**
 * Sidecar 协议（design.md §3.2）：跨进程只经 sidecar 文件单向传信号。
 * 子写 .done/.drop，父侧 watcher 消费；tmp+rename 原子写。
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

/** 消费 = rename 为 .consumed，保留审计痕迹，防 watcher 重复触发。 */
export function consume(path: string): void {
  try {
    renameSync(path, `${path}.consumed`);
  } catch {
    // 已被消费或文件消失——幂等。
  }
}

/** 子侧首条定位消息注入的幂等标记（进程重启/会话 resume 后不重复注入）。 */
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
