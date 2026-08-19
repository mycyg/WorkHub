import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// CHAT-10：Spotlight 文案基调收敛的回归守卫——
//  1) 错误与破坏性操作文案（error/失败/toast/danger/删除/打回…）里绝不出现颜文字；
//  2) 空状态（wh-spot-empty-face）每个块最多一个颜文字/emoji 脸——保留一点性格，但不堆叠。
// 扫源码而不是渲染产物：视图的 HTML 多为运行时拼接，源码行已经是文案的最小可读单元
//（同 cuu-cat-live2d-runtime.test.ts 读 public html 的既有取舍）。
const testDir = dirname(fileURLToPath(import.meta.url));
const viewsDir = resolve(testDir, "views");

const KAOMOJI = /ω|◡|◜|◝|٩|۶|ヾ|ﾉ|≧|≦|ᵕ|˶|╥|﹏|\(=|｡ﾟ/gu;
// 一张「脸」的完整匹配（计数单位是脸、不是字符——٩(◜◡◝)۶ 是一张脸，不是五个字符）。
const KAOMOJI_FACE = /[٩۶]?[(（][^()（）]{0,12}[ω◡ｪ･][^()（）]{0,12}[)）][٩۶]?/gu;
const ERROR_OR_DESTRUCTIVE = /error|失败|错误|toast\(|danger|删除|打回|拒绝|deny|destructive/iu;

function viewSources(): Array<{ file: string; lines: string[] }> {
  return readdirSync(viewsDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      file: `spotlight/views/${name}`,
      lines: readFileSync(resolve(viewsDir, name), "utf8").split("\n")
    }));
}

test("spotlight error and destructive copy never carries kaomoji", () => {
  for (const { file, lines } of viewSources()) {
    lines.forEach((line, index) => {
      if (!ERROR_OR_DESTRUCTIVE.test(line)) {
        return;
      }
      assert.doesNotMatch(
        line,
        KAOMOJI,
        `${file}:${index + 1} — kaomoji in error/destructive copy is not allowed`
      );
    });
  }
});

test("spotlight empty states keep at most one kaomoji face per block", () => {
  for (const { file, lines } of viewSources()) {
    lines.forEach((line, index) => {
      if (!line.includes("wh-spot-empty-face")) {
        return;
      }
      const count = (line.match(KAOMOJI_FACE) ?? []).length;
      assert.ok(count <= 1, `${file}:${index + 1} — empty state carries ${count} kaomoji faces, keep at most one`);
    });
  }
});

test("the capability placeholder note is kaomoji-free (copy, not a face block)", () => {
  const source = readFileSync(resolve(viewsDir, "placeholder.ts"), "utf8");
  const noteLine = source.split("\n").find((line) => line.includes("wh-spot-placeholder-note"));
  assert.ok(noteLine);
  assert.doesNotMatch(noteLine, KAOMOJI);
});
