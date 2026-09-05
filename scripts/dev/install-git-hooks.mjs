// 安装 lefthook 提交钩子（pnpm `prepare` 入口）。只在「真正的开发检出」里做：
// Docker 镜像构建（无 git 二进制、常无 .git）、CI（钩子无意义）、显式跳过时静默退出，
// 否则 `pnpm install` 会在这些环境里因 lefthook 找不到 git 而整体失败（pilot-stack CI 曾因此红）。
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const skip =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.WORKHUB_SKIP_GIT_HOOKS === "1" ||
  !existsSync(".git");
if (skip) {
  process.exit(0);
}
const git = spawnSync("git", ["--version"], { stdio: "ignore" });
if (git.status !== 0) {
  process.exit(0);
}
const result = spawnSync("pnpm", ["exec", "lefthook", "install"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
process.exit(result.status ?? 1);
