/**
 * 宿主捆绑的 dsh 依赖版本——从**本包自己的 package.json** 现读，而不是在代码里抄一份常量。
 *
 * 为什么重要：R24-P 阶段 1 的安装前体检要把「插件声明它要哪个版本」和「我们捆的是哪个版本」
 * 两个数摆在一起给人看（报告风险 3：dsh 0.1.x 在持续破坏兼容）。抄一份常量迟早会跟
 * `pnpm up` 之后的真实依赖对不上，那时体检会理直气壮地说错话——比不做体检更糟。
 */
import { readFileSync } from "node:fs";

type PluginHostManifest = {
  dependencies?: Record<string, string>;
};

let cached: Record<string, string> | undefined;

function dependencies(): Record<string, string> {
  if (!cached) {
    // src/ 的上一级就是包根。读失败（被打包成别的目录结构）不该让 API 起不来——退化成「不知道」。
    try {
      const manifest = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8")
      ) as PluginHostManifest;
      cached = manifest.dependencies ?? {};
    } catch {
      cached = {};
    }
  }
  return cached;
}

/** 宿主捆绑的 `@deepseek-ai/dsh-tools` 版本（本包 package.json 里钉的那个精确版本）。 */
export function hostBundledDshToolsVersion(): string | undefined {
  return dependencies()["@deepseek-ai/dsh-tools"];
}

/** 宿主捆绑的 `@deepseek-ai/cordis` 版本。 */
export function hostBundledCordisVersion(): string | undefined {
  return dependencies()["@deepseek-ai/cordis"];
}
