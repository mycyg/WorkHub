# WorkHub Systematic Code Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dispatching-parallel-agents for the independent audit lanes. This is a read-only review plan; no product-code changes are authorized.

**Goal:** Review the latest WorkHub `main` snapshot end to end, identify concrete code defects and disconnected product/data flows, and deliver an evidence-backed Chinese report.

**Architecture:** Treat `/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full` at `33f52b16` as the immutable review target. Run three independent file-by-file audit lanes (desktop/CU, web/UI, backend/data) while the owner thread verifies repository-wide contracts, mounts, consumers, tests, and cross-surface gaps.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Fastify, PostgreSQL/Drizzle, SSE/Redis, Tauri/Rust, Vite web clients.

## Global Constraints

- Review only commit `33f52b16` on `main`, confirmed equal to `origin/main` on 2026-07-17.
- Do not modify product code, migrations, tests, configuration, or generated assets.
- Findings require an exact file and line, a reproducible trigger path, root-cause evidence, and user/data impact.
- Classify gaps as frontend-only, backend-only, or missing end to end.
- Errors must not be silently swallowed; observability and traceability gaps are review targets.
- The owner thread independently validates all sub-agent findings before publication.

---

### Task 1: Freeze the review baseline and inventory

**Files:**
- Inspect: `/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full/**`
- Create: `reports/WorkHub-系统代码审查-2026-07-17.md`

**Interfaces:**
- Consumes: Git worktree and remote branch metadata.
- Produces: immutable commit handle and categorized source-file inventory.

- [ ] Confirm the target worktree is clean and `HEAD` is `33f52b16`.
- [ ] Count tracked production, test, migration, script, and documentation files separately.
- [ ] Exclude vendored `reference/**`, generated output, dependencies, and binary artifacts from line-level review, while checking that they cannot enter production builds unexpectedly.

### Task 2: Audit desktop, CU, and native runtime

**Files:**
- Inspect: `apps/desktop/**`
- Inspect: `apps/desktop-webview/**`
- Inspect: directly used native/CU packages and `scripts/qa/cuu-*`

**Interfaces:**
- Consumes: shared contracts, API routes, SSE events, permissions, Tauri commands.
- Produces: desktop/CU findings, flow map, coverage and test evidence.

- [ ] Trace every user action to its native command or API endpoint and response renderer.
- [ ] Review confirmation, permissions, progress, interruption, recovery, errors, empty/loading states, deep links, and accessibility.
- [ ] Run package tests, type checks, Rust checks, and relevant CU static QA that do not require product-code changes.

### Task 3: Audit web and shared UI

**Files:**
- Inspect: `apps/web/**`
- Inspect: `packages/ui/**`
- Inspect: directly consumed client contracts, events, permissions, and route-state modules.

**Interfaces:**
- Consumes: HTTP/SSE contracts and browser routing state.
- Produces: web/UI findings, interaction-to-data map, coverage and test evidence.

- [ ] Trace navigation, controls, mutations, loading/error/empty/permission states, refresh and deep links to backend behavior.
- [ ] Check responsive behavior, keyboard/accessibility semantics, stale state, optimistic state, and failure recovery.
- [ ] Run web/UI tests, type checks, build, and static scans.

### Task 4: Audit backend, data, events, and contracts

**Files:**
- Inspect: `apps/api/**`
- Inspect: `packages/db/**`
- Inspect: `packages/contracts/**`
- Inspect: `packages/events/**`
- Inspect: `packages/permissions/**`
- Inspect: `packages/agent/**`

**Interfaces:**
- Consumes: database schema/migrations and external provider configuration.
- Produces: API/data findings, write-event-read-consumer map, coverage and test evidence.

- [ ] Trace writes through transactions, events/SSE, API reads, authorization, audit, retry/recovery, and client consumers.
- [ ] Detect unmounted routes, unused contracts/events, write-only/read-only records, in-memory substitutes, fake data, missing idempotency, and concurrency hazards.
- [ ] Run backend/package tests, type checks, migration checks, and static scans.

### Task 5: Cross-check disconnected flows and missing product capabilities

**Files:**
- Inspect: all route registrations, API call sites, event publishers/subscribers, schemas/migrations, product plans, and user-visible route registries.

**Interfaces:**
- Consumes: outputs from Tasks 2-4.
- Produces: verified gap matrix with frontend-only, backend-only, and missing-end-to-end categories.

- [ ] Enumerate backend routes and compare them with web/desktop call sites.
- [ ] Enumerate client API calls and compare them with mounted routes/contracts.
- [ ] Enumerate emitted event types and compare them with active consumers.
- [ ] Compare implemented surfaces with current product/design documents and label intentional deferrals separately from defects.

### Task 6: Verify and publish the review report

**Files:**
- Create: `reports/WorkHub-系统代码审查-2026-07-17.md`

**Interfaces:**
- Consumes: validated findings, command output, coverage inventory, and gap matrix.
- Produces: one evidence-backed Chinese review report.

- [ ] Re-open every cited line in commit `33f52b16` and reject findings without a complete trigger path.
- [ ] De-duplicate shared root causes and assign P0/P1/P2/P3 severity by user/data impact.
- [ ] Record exact commands and pass/fail counts; do not hide environment failures.
- [ ] Publish findings first, then coverage limits, test evidence, gap matrix, optimization priorities, and a staged remediation order.
