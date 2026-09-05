// WorkHub API · 这台服务端跑的是哪个版本（GET /api/health 的 version 字段，R24 S3）。
//
// 为什么需要：桌面客户端在「连接服务器」屏上要显示这台自托管实例的版本——排障第一句话就是
// 「你服务端是哪个版本」，此前没有任何端点亮出来，只能让管理员去容器里看。
//
// 解析顺序（先命中先用）：
//   1) env WORKHUB_VERSION —— 构建/发布流水线注入（容器镜像里没有仓库 package.json 时的正路）；
//   2) 仓库根 package.json 的 version —— 源码运行（pnpm start / tsx）时的正路；
//   3) 常量兜底 —— 两条都读不到时不让健康探针失败，只是版本显示为未知值。
// 只在模块首次加载时解析一次并缓存：健康探针是高频存活探测口，不能每次都去读文件。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UNKNOWN_VERSION = "0.0.0-unknown";

function readVersionFromPackageJson(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src → 仓库根；退而求其次读 apps/api 自己的 package.json。
  const candidates = [
    path.resolve(here, "../../../package.json"),
    path.resolve(here, "../package.json")
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // 读不到/不是 JSON：试下一个候选。
    }
  }
  return undefined;
}

function resolveWorkHubApiVersion(): string {
  const injected = process.env.WORKHUB_VERSION?.trim();
  if (injected) {
    return injected;
  }
  return readVersionFromPackageJson() ?? UNKNOWN_VERSION;
}

const cached = resolveWorkHubApiVersion();

export function workHubApiVersion(): string {
  return cached;
}
