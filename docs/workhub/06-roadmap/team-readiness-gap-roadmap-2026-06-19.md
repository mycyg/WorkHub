---
status: active
audit_round: 3
kind: team-readiness-roadmap
date: 2026-06-19
---

# WorkHub 团队就绪度差距路线图（R3，2026-06-19）

> 来源：R3 多智能体团队就绪度分析（71 条已现实核查的缺口，见 [`full-codebase-audit-round3-2026-06-19.md`](./archive/full-codebase-audit-round3-2026-06-19.md)）。本轮 `fix all` 已落地其中可有界、无需产品拍板的项（标 ✅）；其余按 must→should→nice 排序，标注工本、做法、是否需产品决策。**标 [EPIC] 的是多周专项 + 多需产品/基建决策，不在自动循环里硬建（避免回归绿库），应各自单独 plan-first PR。**

## ✅ 本轮已落地（6，全 CI 绿）

- **[ops-observability-reliability]** No process-level crash guard (uncaughtException / unhandledRejection)
- **[ops-observability-reliability]** /api/health is a static stub — no real readiness/liveness checks
- **[ops-observability-reliability]** No request/run correlation IDs or distributed tracing
- **[security-compliance]** No HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- **[security-compliance]** No dependency/CVE scanning or secret-scanning in CI
- **[security-compliance]** No request body-size limit (large-payload DoS) and no SECURITY.md / vulnerability-disclosure policy
（另：B2 进程崩溃守卫/安全头、B7 桌面 CSP、G1 body-size/ /api/ready / SECURITY.md / 依赖扫描 CI / X-Request-Id —— 见对应 fix commit。）

## identity-auth-rbac

**现状**：The backend auth layer is genuinely mature; the gaps are concentrated at the FRONTEND surface and in the role model. What exists: IDENTITY/AUTH (apps/api/src/routes/auth.ts, middleware/auth.ts, auth/password.ts): - Nickname identify with optional admin-claim via ADMIN_CLAIM_SECRET (constant-time compare, per-source throttle in admin-claim-throttle.ts; promote-to-admin; bad-secret fail-closed 403/4

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| must-have | M | ⬜ 待建(有界) | No password reset / recovery flow (no token table, no route, no UI) | Out-of-band invite plumbing (hashed one-time token + TTL) is a close template that reset c |
| should-have | L | ⬜ 待建(有界) | No frontend UI for password/invite/session auth — entire auth epic is backend-only and unr | Backend routes + api-client identify/me/logout/preferences exist; nickname onboarding scre |
| should-have | L | ⬜ 待建(有界) | Membership role (member/admin/owner) is a dead column — no per-workspace RBAC, only a sing | Role column + MembershipRole type + permission-engine 'role' scope all exist as plumbing;  |
| should-have | XL | 🟥 EPIC | No SSO / OIDC providers wired (abstraction is a zero-provider stub) | Session schema reserves auth_method='oidc' + oidc_provider column and mintSession has an o |
| should-have | L | 🟥 EPIC | No MFA / 2FA (no TOTP, WebAuthn/passkey, or step-up auth) | none |
| should-have | M | ⬜ 待建(有界) | No email verification flow despite the infrastructure being half-built | email_verified_at column + setEmailVerified repo method exist and are exercised only on in |
| should-have | M | ⬜ 待建(有界) | No admin account-management endpoints/UI: cannot list users, unlock locked accounts, or li | Repo methods exist (invites.revoke/listPendingForEmail, sessions.revokeAllForUser, credent |

## multi-tenancy-isolation

**现状**：WorkHub is structurally multi-tenant and has a real, staged defense-in-depth program (docs/workhub/06-roadmap/archive/r2-epic-multi-tenancy-plan-2026-06-18.md tracks it; Phases 1–3a done, Phase 4 in progress). Concretely verified: MEMBERSHIP MODEL (real): packages/db/migrations/0024_workspace_memberships.sql + schema/core.ts:156 define workspace_memberships(workspace_id→workspaces, user_id→users, role mem

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| must-have | M | ⬜ 待建(有界) | NULL-tenant rows are an unclosed cross-tenant leak (Phase 5 backfill + strict predicate ne | Plan documents the Phase 5 backfill (UPDATE work_items SET workspace_id=projects.workspace |
| must-have | M | ⬜ 待建(有界) | Admin cost dashboard leaks spend across all workspaces (cost_ledger_entries has no workspa | Non-admin user-scope fail-close is solid (pages.ts:378-382); team budget card now uses act |
| should-have | M | 🟥 EPIC | No second-workspace / second-org provisioning path (only the single default workspace can  | Schema (orgs, workspaces, workspace_memberships) and the per-user membership-derivation pa |
| should-have | L | ⬜ 待建(有界) | Zero tenant predicate on several enumerable repos (notifications, schedule, approvals, pro | Plan Phase 4 specifies a shared tenantPredicate helper and per-repo fences via work_items/ |
| should-have | M | ⬜ 待建(有界) | No per-workspace settings or quotas | budget_policies team-scope provides per-workspace cost limits only; orgs.plan column exist |
| should-have | L | ⬜ 待建(有界) | No tenant data export or delete (offboarding / GDPR) | workspace_memberships/projects cascade or set-null on workspace delete at the schema level |
| nice-to-have | M | 🟥 EPIC | No workspace-switching UX/API for multi-workspace users | membership repo has listForUser (the candidate set) and findActiveForUserWorkspace (the va |
| nice-to-have | L | 🟥 EPIC | No Postgres RLS (enforcement is app-layer + partial repo predicate only) | Defense-in-depth is intentionally app+repo layer; RLS is documented as deferred, not built |
| nice-to-have | L | 🟥 EPIC | No cross-org/cross-workspace admin view; org membership is derived, so no standalone org a | Global is_admin boolean exists and short-circuits most permission checks; membership.role  |

## collaboration-realtime

**现状**：The realtime backbone is genuinely production-grade. SSE transport (apps/api/src/sse/stream.ts, apps/api/src/routes/push.ts) offers per-topic authenticated streams (/stream, /stream/me, /stream/workitem/:id, /stream/run/:id, /stream/session/:id, /stream/proposal/:id) with 30s heartbeat pings, topic-access authz (apps/api/src/sse/topic-access.ts), and honest "fresh" resume semantics (it does NOT re

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| must-have | M | ⬜ 待建(有界) | @mentions in comments (and anywhere) | Comment tables and POST routes exist; notification infra + user directory exist to build o |
| must-have | M | ⬜ 待建(有界) | Notification preferences / quiet hours / per-type mute | Lifecycle drafts have a fixed recipient/severity policy (packages/events/src/lifecycle.ts) |
| should-have | L | ⬜ 待建(有界) | Real out-of-band delivery (email + web/native push) | Durable notification rows + SSE in-app delivery exist; client_devices registration table+r |
| should-have | M | ⬜ 待建(有界) | Time-based reminder / digest scheduler (push, not read-derived) | Due/meeting notification CONTENT is derived correctly on read; worker scheduling pattern e |
| should-have | M | ⬜ 待建(有界) | Presence indicators surfaced to users | Full Redis+in-memory presence store with TTL + stream-count semantics (apps/api/src/broker |
| should-have | L | ⬜ 待建(有界) | Escalation routing / on-call rotation / reassignment | Static single-recipient fallback chain + escalation.opened event + approval expiry sweep ( |
| nice-to-have | M | ⬜ 待建(有界) | Comment threads + reactions | Flat comment create+list with author label and created_at ordering (packages/db/src/reposi |
| nice-to-have | M | ⬜ 待建(有界) | Shared saved views / filters | none |
| nice-to-have | M | ⬜ 待建(有界) | Calendar invites / RSVP / meeting attendance state | schedule_events with participant id list + event_type; meeting_records/insights pipeline.  |

## ops-observability-reliability

**现状**：WorkHub has a genuinely solid pilot-grade ops baseline, well above a typical prototype: DEPLOYMENT: Single-image build (`Dockerfile`) packs the API daemon + prebuilt Web static (same-origin, no CORS), plus a sandbox capability layer (Python/pandas/matplotlib + Noto CJK fonts). `docker-compose.pilot.yml` orchestrates postgres:16 + redis:7 + workhub with container-level healthchecks (`pg_isready`, `

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| must-have | S | ✅ 已落地 | No process-level crash guard (uncaughtException / unhandledRejection) | none (only Hono's per-request app.onError exists, which cannot catch errors thrown outside |
| should-have | L | 🟥 EPIC | In-process agent execution blocks horizontal scaling and risks crashing the API | The hard part is done: PG queue has claimNextQueued/claimQueued/heartbeatClaim/requeueExpi |
| should-have | S | ✅ 已落地 | /api/health is a static stub — no real readiness/liveness checks | checkDatabaseHealth(db) (select 1 as ok) exists but is unused; the endpoint and container  |
| should-have | M | 🟥 EPIC | No metrics export (Prometheus / OpenTelemetry) | Rich signals already computed (http_request duration_ms in logs; recovery scheduler stats( |
| should-have | M | ⬜ 待建(有界) | No error tracking / alerting (Sentry-equivalent) or on-call path | Structured logger distinguishes error events with context/stack and there's an explicit on |
| should-have | M | ⬜ 待建(有界) | Graceful shutdown does not drain in-flight agent runs | Lease-expiry requeue + dead-lettering means a killed run is eventually recovered (no data  |
| should-have | M | ⬜ 待建(有界) | No general API rate limiting / abuse protection | admin-claim-throttle (in-memory, single-process) for the admin secret only; cost-budget re |
| should-have | M | ⬜ 待建(有界) | No automated/tested backup-restore and no PITR | Working dump+rotate script, documented isolated-project restore dry-check, and real manual |
| should-have | M | ⬜ 待建(有界) | No CI deploy/release pipeline | pilot-stack-smoke already builds the full image and boots the stack in CI, so the build pa |
| should-have | M | ⬜ 待建(有界) | Secrets are flat env vars with no management or rotation | Config guard enforces strong COOKIE_SECRET + COOKIE_SECURE in production mode (fail-closed |
| nice-to-have | M | ✅ 已落地 | No request/run correlation IDs or distributed tracing | run_id/work_item_id are present on agent events and the snapshot/trace machinery records p |
| nice-to-have | S | ⬜ 待建(有界) | No operational runbooks for incidents/failure modes | Strong daily-ops runbook + a troubleshooting symptom table in DEPLOY.md exist, but they co |

## security-compliance

**现状**：The codebase has a genuinely solid auth + access-control core, but compliance/governance surfaces are thin. Verified concretely: AUTH & SESSIONS: scrypt PHC hashing with N=2^15, constant-time verify, transparent rehash + algo-rotation hook (apps/api/src/auth/password.ts); password min/max length policy (8–1024). Session epic real: signed httpOnly Lax cookies, sha256(token) stored, absolute + slidi

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| must-have | S | ✅ 已落地 | No HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Pol | none — grep across apps/packages finds no Content-Security-Policy/HSTS/X-Frame-Options/hel |
| should-have | M | ⬜ 待建(有界) | No general request rate-limiting / abuse protection (only admin-claim and per-account logi | createAdminClaimThrottle (in-process window for the shared admin secret) and per-account l |
| should-have | S | ⬜ 待建(有界) | Tauri desktop webview has csp:null (no content security policy) | none — csp is explicitly null. |
| should-have | S | ✅ 已落地 | No dependency/CVE scanning or secret-scanning in CI | Bespoke audit:* scripts in package.json are codebase-hygiene checks (portable-config/targe |
| should-have | M | ⬜ 待建(有界) | Audit log covers almost no security/identity events | Domain audit exists (AI/approval/cost/snapshot paths write audit_logs); auth + many human  |
| should-have | M | ⬜ 待建(有界) | No data-retention / purge policy for audit, access, or LLM I/O data | user_memories.prune is the only retention mechanism in the codebase. |
| should-have | L | ⬜ 待建(有界) | No GDPR / data-subject-request flow: per-user export or erasure | users.softDelete sets deleted_at + rotates cookieToken, but does not erase or anonymize as |
| should-have | M | ⬜ 待建(有界) | No org-wide audit query/export endpoint for compliance review | audit_logs has all needed indexes and a per-work-item read; no admin/org-wide filtered rea |
| should-have | L | 🟥 EPIC | No MFA / second factor | none. |
| should-have | M | ⬜ 待建(有界) | No user-facing session management (list active sessions / revoke / log out other devices) | Server-side absolute+idle TTL and deleteExpired sweep exist; no listing/revocation API or  |
| should-have | M | ⬜ 待建(有界) | No PII redaction / secret scrubbing on the LLM prompt path or in logs | r5-10-real-key-evaluation.ts scrubs API keys from its QA artifact only. |
| nice-to-have | M | ⬜ 待建(有界) | Audit log is fully mutable — no append-only enforcement or tamper-evidence | Rows carry createdAt + indexes and file snapshots store contentSha256, but the audit rows  |
| nice-to-have | L | ⬜ 待建(有界) | No encryption-at-rest posture or in-app TLS/HSTS; sensitive LLM I/O unclassified | none in code; only mentioned as a gap in the roadmap audit doc. |
| nice-to-have | S | ✅ 已落地 | No request body-size limit (large-payload DoS) and no SECURITY.md / vulnerability-disclosu | Password length is bounded (1024) to cap scrypt cost; no global request body limit; no SEC |

## product-workflow-completeness

**现状**：WorkHub is a mature single-tenant team app with the core loop fully built and real (not stubbed). Verified against actual code: INTAKE→AI→REVIEW→MERGE LOOP (real): intake sessions (`apps/api/src/routes/sessions.ts`: bootstrap, next-question), AgentRun creation/trace/abort/handoff/replay (`apps/api/src/routes/agent-runs.ts`, `workers/agent-runner.ts`), proposals review/merge/rebase + multi-proposal

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| must-have | M | ⬜ 待建(有界) | User offboarding data handover / ownership reassignment | Access cutoff on deactivate (session/device revoke, soft-delete, forgetUser); zero data/ow |
| should-have | L | 🟥 EPIC | Global cross-entity search | Scoped per-work-item knowledge RAG retrieval only (work-items.ts searchKnowledge); no glob |
| should-have | L | ⬜ 待建(有界) | External notification/reminder delivery + due-date reminder firing | In-app SSE notifications + read/dismiss; due_at/sla_due_at data and overdue display in cal |
| should-have | L | 🟥 EPIC | Admin console / editable settings UI (users, roles, budgets, providers) | Read-only settings page + scattered admin-gated APIs (deactivate, budget PUT, permission p |
| should-have | L | 🟥 EPIC | Reporting/analytics dashboards beyond cost + CSV export | Cost dashboard + project-health page + worklog today-metrics; no autonomy/trust analytics  |
| should-have | M | ⬜ 待建(有界) | Bulk operations on lists (approvals, notifications, work items) | Single read-all for notifications; everything else is per-item by id. |
| should-have | M | ⬜ 待建(有界) | Saved filters / views and list filtering/sort/pagination | A few fixed query params (project_id, calendar date/view); no general filtering/sort/pagin |
| should-have | L | 🟥 EPIC | External integrations (Slack / GitHub / email / calendar sync) | none (in-app SSE only); architecture is LAN-first by design. |
| nice-to-have | M | ⬜ 待建(有界) | Templates (work-item / project / intake presets) | none |
| nice-to-have | M | ⬜ 待建(有界) | Keyboard shortcuts / fuller accessibility pass | Partial ARIA on nav and toggles; responsive @media breakpoints exist; no keyboard shortcut |
| nice-to-have | M | ⬜ 待建(有界) | Undo/history beyond AI-run replay | Per-run snapshot revert + per-work-item audit log + drive soft-delete/restore; no general  |

## ai-quality-cost-safety

**现状**：WorkHub already has a genuinely strong AI quality/cost/safety core — not stubs. Concretely: COST CONTROL (mature). `packages/cost/src/budget.ts` defines 5 layered policies (workitem-run, user-day, team-day, team-month, eval-day) with warning(0.8)/critical(0.95)/exhausted ratios and onWarning/onExhausted actions (downgrade_model / block_new_run / handoff). `decision.ts` (decideRunBudget) evaluates

| 重要度 | 工本 | 状态 | 缺口 | 做法/备注 |
|--------|------|------|------|----------|
| should-have | M | 🟥 EPIC | Continuous AI-quality eval harness in CI/prod (regression detection) | r5-10-real-key-evaluation.ts is a complete real-key harness with quality gates and produce |
| should-have | L | ⬜ 待建(有界) | Provider fallback / routing on outage (no second provider, no circuit breaker) | Retry-with-backoff on 429/5xx/network exists (retry.ts); the registry abstraction (registr |
| should-have | M | ⬜ 待建(有界) | Proactive cost alerts (budget alerts only surface reactively) | BudgetNotice objects with severity and recommended actions are fully built and surfaced in |
| should-have | M | ⬜ 待建(有界) | Per-team human-in-the-loop gate config (auto-merge policy is not configurable) | Full verdict matrix (auto_merge/human_spotcheck/escalate), risk dimensions, and the autoMe |
| nice-to-have | M | ⬜ 待建(有界) | Rate-limiting / concurrency cap on LLM calls | Budget reservations cap total spend and retry.ts backs off on 429 after the fact; queue le |
| nice-to-have | M | ⬜ 待建(有界) | Output moderation / PII redaction on AI deliverables | redactSecrets exists but is scoped to the eval-report writer only; no production deliverab |
| nice-to-have | S | ⬜ 待建(有界) | Cost forecasting / burn-rate projection | aggregateTrend (pages/cost.ts) produces per-day cost/token series and top_exhaustion_risks |
| nice-to-have | L | 🟥 EPIC | Prompt versioning + A/B experimentation | confidence signalsJson records the model id and a policy_version for the confidence policy |
| nice-to-have | L | ⬜ 待建(有界) | Grounding / citation enforcement for AI claims | Evidence bindings are surfaced into the run context (agent-runner.ts formatWorkItemContext |

## 建议施工顺序（剩余项）

1. **有界 must-have（无需拍板，应优先建）**：密码重置流（reset-token 表+/forgot+/reset，沿用 out-of-band 链接范式）；@mentions（评论里解析 @nickname→通知，复用 notifications 表）；通知偏好/静音（用户级 prefs）；用户离职数据交接（停用时把所属工作项重指派——需定一个默认接管人规则）。
2. **有界 should/nice（机械可做）**：org-wide 审计查询/导出端点；会话管理 UI（列活跃会话/吊销）；请求级 distributed tracing（接 OTel）；bulk 操作 / 列表筛选分页 / 保存视图。
3. **[EPIC] 多周 + 需产品决策（各自 plan-first）**：OIDC/SSO（接哪些 provider）；MFA/2FA；管理控制台 UI；外部集成（Slack/GitHub/email/calendar——选哪些）；全局搜索；metrics/告警栈；多租户 Phase4/5 正式切换（NULL 回填 + 严格租户谓词 + cost_ledger workspace_id + RLS——上第二工作区前的前置）；持续 AI 质量 eval 栈；provider 故障转移/路由。

> 多租户类 must-have（NULL 回填 / cost_ledger workspace_id）在当前单租户部署下不可被利用，是「上第二工作区的前置」，已归入多租户 Phase4/5 EPIC。
