/**
 * pi-branches 入口：同一扩展目录同时服务父/子两种角色。
 * 父进程（用户主会话）加载时无 PI_BRANCH_ROLE，走父侧逻辑；
 * 子进程由父侧以 `PI_BRANCH_ROLE=child pi --fork ... -ne -e <本目录>` 拉起，
 * 同一目录按 env 分流到子侧逻辑。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initParent } from "./src/parent.ts";
import { initChild } from "./src/child.ts";

export default function (pi: ExtensionAPI) {
  if (process.env.PI_BRANCH_ROLE === "child") {
    initChild(pi);
  } else {
    initParent(pi);
  }
}
