# loop2 vendor NOTICE

This directory vendors the pure-function agent loop and its type foundation from
**pi** (a.k.a. `@earendil-works/pi-*`).

- Upstream: https://github.com/earendil-works/pi
- License: MIT (Copyright (c) 2025 Mario Zechner) — see the upstream `LICENSE`.
- Vendored from commit: `dcfe36c79702ec240b146c45f167ab75ecddd205`
- Vendor date: 2026-07-15
- Vendored by: WorkHub r15 batch C, loop2 Phase 0 (`packages/agent/src/loop2/`).

## Scope

This is a **near-verbatim** vendor with **zero production wiring**. The vendored
loop is exported only from `loop2/index.ts` (an internal path); it is not added to
the `@workhub/agent` package entry point, and the existing production loop
(`../loop`), turns (`../turns`), providers, and agent-runner are untouched. Real
provider/tool/result adapters land in later phases.

## Files

| loop2 file | pi source | Notes |
|---|---|---|
| `vendor/agent-loop.ts` | `packages/agent/src/agent-loop.ts` | Loop body. Control flow kept line-for-line comparable with pi. |
| `vendor/types.ts` | `packages/agent/src/types.ts` | `AgentLoopConfig` / `AgentMessage` / `AgentTool` / `AgentToolResult` / `AgentEvent` contract. |
| `vendor/ai-types.ts` | `packages/ai/src/types.ts` (minimal subset) | Message / model / options / event type closure that the loop needs. |
| `vendor/event-stream.ts` | `packages/ai/src/utils/event-stream.ts` | `EventStream` / `AssistantMessageEventStream`. Near-verbatim. |
| `vendor/validation.ts` | `packages/ai/src/utils/validation.ts` (replaced) | typebox-free, injectable `validateToolArguments` stub (see below). |
| `vendor/compat.ts` | `packages/ai/src/compat.ts` (minimal barrel) | Mirrors the compat import surface the loop uses; `streamSimple` is a stub. |

## Adaptations (each allowed change, recorded)

1. **Import paths.** pi imports with `.ts` ESM extensions and via package aliases
   (`@earendil-works/pi-ai/compat`, `@earendil-works/pi-ai`, `typebox`). All were
   rewritten to WorkHub's relative `.js`-suffixed NodeNext style pointing at the
   local vendor files. No other import changes.

2. **typebox removed (no new dependency).** pi types `AgentTool.parameters` as a
   typebox `TSchema` and derives argument types with `Static<TParameters>`. The
   vendor collapses this to a JSON Schema object shape:
   - `ai-types.ts`: `Tool.parameters` is `JsonSchema = Record<string, unknown>`.
   - `types.ts`: `AgentTool<TParameters extends JsonSchema = JsonSchema>`;
     `prepareArguments` returns and `execute` receives `Record<string, unknown>`
     (pi's `Static<TParameters>`).
   Real schema validation is deferred to Phase 1's tool wrapper, which will
   delegate to zod. `zod` was **not** migrated to typebox and no npm dependency
   was added.

3. **Injectable `validateToolArguments`.** pi's implementation compiles the tool's
   typebox schema and coerces/validates against it. The vendor replaces it with a
   passthrough stub (deep-clones and returns the raw arguments) exposed through a
   module-level seam: `setToolArgumentValidator(fn | null)`. The loop keeps calling
   the exported `validateToolArguments` binding unchanged; Phase 1 injects the real
   (zod-backed) validator. Throwing from a validator still surfaces as an immediate
   error tool result via the loop's `prepareToolCall` catch, exactly as in pi.

4. **`streamSimple` default is a stub.** The loop uses `streamFn || streamSimple`.
   pi's default resolves a real provider; Phase 0 has no provider, so the vendor
   `streamSimple` throws a clear "pass an explicit streamFn" error. Every Phase 0
   caller and test injects `streamFn`, so the default path is never taken.

5. **Minimal ai-types closure.** Only the message/model/options/event types the
   loop and its config reference were extracted from pi's 736-line `ai/src/types.ts`.
   Reductions: `Api`/`ProviderId` collapsed from pi's `KnownApi`/`KnownProvider`
   unions to `string` (the loop treats them as opaque); `Model.compat` collapsed to
   `unknown` (never inspected); `AssistantMessage.diagnostics` typed as `unknown[]`;
   provider-implementation callbacks (`onPayload`/`onResponse`/websocket/retry-delay
   knobs) dropped from `StreamOptions`; image-generation types omitted entirely.

6. **Stricter tsconfig adaptations.** pi does not enable `exactOptionalPropertyTypes`
   or `noUncheckedIndexedAccess`; WorkHub enables both. To compile unchanged control
   flow under these flags:
   - `ai-types.ts`: `StreamOptions.apiKey`/`.signal`, `SimpleStreamOptions.reasoning`,
     and `Context.tools` widened to include `| undefined` (the loop assigns
     resolved-or-undefined values / forwards a possibly-absent tools array).
   - `types.ts`: `AgentToolResult.terminate` widened to `boolean | undefined` (the
     loop's `afterToolCall` merge assigns it) and `AgentContext.tools` widened to
     `| undefined` (forwarded into `Context.tools`).
   - `agent-loop.ts`: two `!` non-null assertions on `context.messages[...]` reads in
     the continuation guards (each immediately preceded by a length check), annotated
     inline. No behavior change.

## Deviations from pi behavior

None intended. All changes above are type-surface or import-path adaptations plus
the two stubs (validation, streamSimple) that stand in for Phase 1 adapters. The
runtime control flow of `runLoop` and its helpers is unchanged from the pi original.
