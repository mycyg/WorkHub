import assert from "node:assert/strict";
import test from "node:test";

import { findTestConventionViolations } from "./check-test-conventions.ts";

test("对 process.stdout.write / stderr.write 的赋值被拦下，比较与透传包装不算", () => {
  const violations = findTestConventionViolations([
    {
      path: "apps/x/src/a.test.ts",
      text: [
        'const originalWrite = process.stdout.write.bind(process.stdout);',
        "process.stdout.write = ((chunk) => true) as typeof process.stdout.write;",
        "process.stderr.write=(c)=>true;",
        "if (process.stdout.write === original) {}",
        "const { lines } = await captureStdoutLines(async () => {});"
      ].join("\n")
    }
  ]);
  assert.deepEqual(
    violations.map((v) => [v.line, v.rule]),
    [
      [2, "stdout_write_reassigned"],
      [3, "stdout_write_reassigned"]
    ]
  );
});

test("行内 test-conventions-allow 豁免只作用于那一行", () => {
  const violations = findTestConventionViolations([
    {
      path: "c.test.ts",
      text: [
        "process.stdout.write = tee; // test-conventions-allow：测的就是这条流本身",
        "process.stdout.write = other;"
      ].join("\n")
    }
  ]);
  assert.deepEqual(violations.map((v) => v.line), [2]);
});

test("干净的测试文件零命中", () => {
  assert.deepEqual(findTestConventionViolations([{ path: "b.test.ts", text: "test('x', () => {});" }]), []);
});
