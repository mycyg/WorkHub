import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { InternalContractError, parseOutputContract } from "./pages/output-contract.js";

test("parseOutputContract returns the parsed value on success", () => {
  const schema = z.object({ a: z.string() });
  assert.deepEqual(parseOutputContract(schema, { a: "x" }, "ctx"), { a: "x" });
});

test("findings[#79] parseOutputContract wraps an output-assembly ZodError as InternalContractError(->500) with context", () => {
  const schema = z.object({ outcome_reason: z.string().max(256) });
  let thrown: unknown;
  try {
    parseOutputContract(schema, { outcome_reason: "x".repeat(300) }, "agent-run-vm");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof InternalContractError, "output-boundary parse failure must be InternalContractError, not raw ZodError");
  assert.equal((thrown as InternalContractError).context, "agent-run-vm");
  // issues 留作服务端日志，绝不回给调用方/不当成 422 客户端错误。
  assert.ok(Array.isArray((thrown as InternalContractError).issues));
});

test("parseOutputContract rethrows non-Zod errors unchanged", () => {
  const boom = new Error("boom");
  const schema = z.object({ a: z.string() }).superRefine(() => {
    throw boom;
  });
  assert.throws(() => parseOutputContract(schema, { a: "x" }, "ctx"), (error: unknown) => error === boom);
});
