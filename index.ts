/**
 * pi-branches entry point: one extension directory serving two roles.
 * The parent process (the user's main session) loads without PI_BRANCH_ROLE and
 * gets parent behavior; children are spawned as
 * `PI_BRANCH_ROLE=child pi --fork ... -ne -e <this directory>` and the same
 * directory dispatches to child behavior via that env var.
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
