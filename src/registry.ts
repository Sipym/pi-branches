/**
 * 登记表（design.md §2）：父侧扩展的持久化状态。
 * 位置：~/.pi/agent/artifacts/pi-branches/<parentSessionId>/registry.json
 * sidecar 同目录：<childSessionId>.done / .drop / .booted / .consumed
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson } from "./sidecar.ts";

export type BranchStatus = "chatting" | "delivered" | "dropped";

export interface BranchRecord {
  name: string;
  question: string;
  childSessionId: string;
  sidecarBase: string;
  forkEntryId?: string;
  createdAt: string;
  status: BranchStatus;
  deliverCount: number;
  lastMergeId?: string;
}

export interface Registry {
  parentSessionId: string;
  branches: BranchRecord[];
}

export function stateDir(parentSessionId: string): string {
  return join(homedir(), ".pi", "agent", "artifacts", "pi-branches", parentSessionId);
}

export function loadRegistry(dir: string, parentSessionId: string): Registry {
  const reg = readJson<Registry>(join(dir, "registry.json"));
  if (reg && Array.isArray(reg.branches)) return reg;
  return { parentSessionId, branches: [] };
}

export function saveRegistry(dir: string, reg: Registry): void {
  mkdirSync(dir, { recursive: true });
  const tmp = `${dir}/registry.json.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2), "utf8");
  renameSync(tmp, `${dir}/registry.json`);
}

export function nextBranchName(reg: Registry): string {
  let n = reg.branches.length + 1;
  const taken = new Set(reg.branches.map((b) => b.name));
  while (taken.has(`q${n}`)) n++;
  return `q${n}`;
}
