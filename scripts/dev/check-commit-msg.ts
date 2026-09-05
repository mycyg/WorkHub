/**
 * lefthook commit-msg 门禁：只拒绝空 message（去掉注释行和空白行后一个字都不剩）。
 * 不强制 Co-Authored-By trailer——那是这个仓库的写作习惯，不是机械门禁。
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (file === undefined) {
  console.error("check-commit-msg: missing commit message file path argument");
  process.exit(1);
}

const raw = readFileSync(file, "utf8");
const meaningful = raw
  .split(/\r?\n/u)
  .filter((line) => !line.startsWith("#"))
  .join("\n")
  .trim();

if (meaningful.length === 0) {
  console.error("check-commit-msg: commit message is empty (comment lines and blank lines don't count)");
  process.exit(1);
}
console.log("check-commit-msg: ok");
