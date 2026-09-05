/**
 * R25 批 B1：模型可见文本的 golden 门（借鉴 deepseek-harness 的 `*.expected.md` /
 * `*.expected.json` 与 `gen`/`verify` 成对模式，见 snapshots/AGENTS.md）。
 *
 * 为什么是**逐字节**比对而不是语义比对：模型可见文本（系统提示词、工具 schema、工具
 * description）里没有「无关紧要的差异」——一个标点、一处换行、一个字段顺序的变化都会改变
 * 模型的行为与 token 成本。语义比对（关键词命中、结构相等）恰好会放过这一类改动，也就是这道门
 * 唯一想拦住的东西。所以这里比对 Buffer，不做 trim、不做归一化、不排序 JSON 键。
 *
 * 确定性由夹具承担：所有 id、日期、工作目录、样本内容都是常量（见各 *.golden.test.ts 的
 * fixture 段），因此渲染结果本身就是稳定的，不需要 dsh 那样的 `{{token}}` 归一化层。
 *
 * 重生成：`WORKHUB_UPDATE_EXPECTED=1 pnpm test`，或包级 `pnpm gen:expected`。
 */
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATE_EXPECTED = process.env.WORKHUB_UPDATE_EXPECTED === "1";

/** 解析出某个包/应用的 `expected/` 目录（相对该包根，而不是相对 src）。 */
export function expectedDirFrom(importMetaUrl: string, ...upFromFile: string[]): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), ...upFromFile, "expected");
}

/** JSON 落盘口径：2 空格缩进 + 末尾换行；键序 = 生产代码构造对象时的插入序（故意不排序）。 */
export function toGoldenJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Markdown 落盘口径：末尾恰好一个换行（避免编辑器/生成器各写各的尾巴）。 */
export function toGoldenText(value: string): string {
  return `${value.replace(/\n+$/u, "")}\n`;
}

function firstDiff(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < max; i += 1) {
    if (expectedLines[i] === actualLines[i]) {
      continue;
    }
    const from = Math.max(0, i - 3);
    const context = expectedLines
      .slice(from, i)
      .map((line, offset) => `  ${from + offset + 1} | ${line}`)
      .join("\n");
    return [
      context,
      `- ${i + 1} | ${expectedLines[i] ?? "(已到文件末尾)"}`,
      `+ ${i + 1} | ${actualLines[i] ?? "(已到文件末尾)"}`
    ]
      .filter(Boolean)
      .join("\n");
  }
  return `(逐行相同，差异在行尾空白或末尾换行：expected ${Buffer.byteLength(expected)} 字节 / actual ${Buffer.byteLength(actual)} 字节)`;
}

export type GoldenAssertion = {
  /** 该包的 `expected/` 目录绝对路径（用 expectedDirFrom 算）。 */
  dir: string;
  /** 文件名，含后缀：提示词落 `*.expected.md`，工具 schema 落 `*.expected.json`。 */
  name: string;
  /** 渲染结果（已经过 toGoldenText / toGoldenJson 定型）。 */
  actual: string;
};

/**
 * 与已提交的 expected 文件逐字节比对；`WORKHUB_UPDATE_EXPECTED=1` 时改为重生成。
 * 不一致时抛错，错误信息里带首处差异与重生成命令。
 */
export function assertGolden({ dir, name, actual }: GoldenAssertion): void {
  const file = path.join(dir, name);
  const actualBuffer = Buffer.from(actual, "utf8");
  if (UPDATE_EXPECTED) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, actualBuffer);
    return;
  }
  let expectedBuffer: Buffer;
  try {
    expectedBuffer = readFileSync(file);
  } catch {
    throw new Error(
      `golden 缺失：${file}\n这份模型可见文本还没有基线。跑 \`pnpm gen:expected\` 生成后，把 diff 读一遍再提交。`
    );
  }
  if (Buffer.compare(expectedBuffer, actualBuffer) === 0) {
    return;
  }
  throw new Error(
    [
      `golden 不一致：${name}`,
      "模型可见文本变了（提示词 / 工具 schema）。这不是自动通过的改动——先确认这是你想要的变化，",
      "再跑 `pnpm gen:expected` 重生成，并把 diff 摘要贴进 PR（见 AGENTS.md 纪律条）。",
      "",
      firstDiff(expectedBuffer.toString("utf8"), actual)
    ].join("\n")
  );
}
