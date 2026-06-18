# R2 Epic 计划：真认证（密码 + 可插拔 OIDC）

- status: **in-progress（用户已拍板关键 open questions；Phase 1 schema 地基已落、全 CI 绿）**
- created: 2026-06-18
- 来源：2026-06-17 第二轮全量审查的三大「团队就绪地基」之一；用户 2026-06-18 拍板 plan-first 实施。
- 设计依据：design workflow `wf_3b23a675` 在 HEAD 逐文件深读产出（证据带 file:line）。

## 概要

Today WorkHub has no real authentication: POST /api/auth/identify takes only a nickname and silently creates-or-logs-in any user (LAN trust model), with privilege escalation gated by a single shared ADMIN_CLAIM_SECRET. This epic adds a PASSWORD baseline (argon2id) plus real server-side sessions, a first-admin bootstrap to replace the shared secret, real account lifecycle (invite/deactivate/offboard/soft-delete), and a pluggable OIDC provider abstraction (Google/Microsoft/GitHub) with redirect/callback — all behind an AUTH_MODE feature flag so nickname-identify keeps working through migration on both web (cookie) and Tauri desktop (X-*-Client-Token bearer).

## 现状（基于当前代码，带证据）

- Identity = nickname only. POST /api/auth/identify (apps/api/src/routes/auth.ts:52) parses {nickname, admin_secret?} and calls deps.users.getOrCreateActiveByNickname (auth.ts:57) — ANY nickname auto-creates an active account and logs in. There is no password, no credential check for non-admin accounts. This is an intentional LAN trust model.
- There is no password column anywhere. packages/db/src/schema/core.ts:47-69 `users` table has id/nickname/cookieToken/preferredLocale/availability*/isAdmin/deletedAt/timestamps — no passwordHash, no email, no externalId. packages/db/src/repositories/users.ts:25-34 UserRepository has no password methods.
- 'Sessions' are a single signed cookie carrying ONE rotating opaque token per user. issueUserCookie (apps/api/src/middleware/auth.ts:116-124) sets signed cookie `yqgl_id` = user.cookieToken (the column, users_cookie_token_uq partial-unique). Login = look up user by that token (auth.ts:258-265 findActiveByCookieToken). There is no sessions table; cookieToken is single-valued, so logout/rotate on one device invalidates the cookie everywhere (rotateCookieToken auth.ts:149, repositories/users.ts:91).
- Cookie config: COOKIE_SECRET (packages/config/src/env.ts:58), COOKIE_SECURE (env.ts:59), maxAge=1yr (packages/config/src/auth.ts:4 cookieMaxAgeSeconds), SameSite=Lax httpOnly. Production validation in env.ts:269-303 requires COOKIE_SECRET>=32, COOKIE_SECURE=true, ADMIN_CLAIM_SECRET>=16, no '*' CORS.
- Admin model is a single boolean users.isAdmin (core.ts:57). First/any admin is 'claimed' by submitting the shared ADMIN_CLAIM_SECRET to /identify (auth.ts:80-95 promoteToAdmin). Same secret also re-authenticates an existing admin nickname on a new device (auth.ts:73-79). Brute-force throttled in-process (apps/api/src/middleware/admin-claim-throttle.ts; 8 failures/10min → 15min lockout, single-process only). isAdmin drives authz across packages/permissions/src/resource-permissions.ts and evaluate.ts:109 (admin bypass).
- Desktop (Tauri) auth = bearer token, not cookie. client-tauri/src-tauri/src/http.rs:5-32 injects X-WorkHub-Client-Token (+ legacy X-YQGL-Client-Token alias) from config.client_token (config.rs:13). Server side resolveUserFromClientToken (auth.ts:219-241) hashes the raw token (sha256, auth.ts:92-94) and looks up an active client_devices row → its user. Tokens are minted by POST /api/client-devices/register (apps/api/src/routes/client-devices.ts:35-49) which returns the raw token ONCE; client_devices stores only clientTokenHash (core.ts:104-121).
- client-token path is fail-closed and CSRF-exempt: if a client-token header is present but invalid, resolveCurrentUser throws 403 and does NOT fall back to cookie (auth.ts:251-256); CSRF same-origin guard (apps/api/src/middleware/csrf.ts:42) treats presence of the token header as bearer auth and skips the origin check.
- Soft-delete is half-built for users: schema has users.deletedAt + partial-unique indexes WHERE deleted_at IS NULL (core.ts:64-65, migration 0021 M18 comment), and all reads filter deletedAt===null (repositories/users.ts:41,51,61). But NOTHING ever writes users.deletedAt — there is no deactivate/offboard/deleteUser method or route. validateNickname (auth.ts:101) reserves the `_deleted_` prefix for a rename-on-delete convention that is never executed.
- Contracts: identifyRequestSchema = {nickname, admin_secret?} (packages/contracts/src/auth.ts:17-21). Identity/me/logout/device-register response schemas all live in packages/contracts/src/auth.ts. The shared client interface (packages/api-client/src/types.ts:185-188) exposes identify/logout/me/updatePreferences and is used by BOTH web and desktop.
- Web onboarding is nickname + optional admin-secret only. apps/web/src/browser.ts:1192-1218 submitOnboarding posts {nickname, admin_secret?}; there is no email/password field. boot() (browser.ts:1252-1268) calls client.me() and shows the onboarding screen on 401/null.
- Routes wired in apps/api/src/app.ts:97-98 (createAuthRoutes → /api/auth, createClientDeviceRoutes → /api/client-devices). CORS (app.ts:55-63) + same-origin CSRF guard (app.ts:67) run on /api/*; both must keep allowing the OIDC callback and any new auth endpoints.
- Migrations are sequential numbered SQL + meta/_journal.json (packages/db/migrations, last = 0021_soft_delete_and_current_unique.sql). lint runs audit:migrations (scripts/dev/check-migrations.ts) which FORBIDS runtime `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` in apps/packages/scripts (check-migrations.ts:52-57) — every schema change MUST be a new migration file with a matching journal entry. README doc-count gate also fires for docs/workhub/*.md changes.
- Test patterns: route logic is tested with in-memory fakes implementing UserRepository/ClientDeviceRepository (apps/api/src/auth.test.ts:68-120 MemoryUsers), injected via AuthDependencySource (auth.ts:61). Real-PG behavior is covered by apps/api/src/qa/*-smoke.ts run in CI (e.g. qa:r1-pg-smoke). Any new repo method/table needs both a unit fake and a PG smoke assertion.

## 目标架构

Three credential rails behind one feature flag, converging on one server-side session model.

AUTH_MODE env flag = "nickname" (current, default during migration) | "password" | "hybrid". In nickname mode everything behaves exactly as today. password/hybrid unlock the new endpoints; hybrid keeps /identify alive for un-migrated accounts.

(1) CREDENTIALS. New `user_credentials` table (1:1 with users): user_id, email (citext, partial-unique WHERE deleted_at IS NULL), password_hash (argon2id via `@node-rs/argon2` or `argon2`; store full PHC string so params are self-describing), password_updated_at, failed_attempts, locked_until. Email + password become the canonical login. Keep nickname as display_name (already aliased in toIdentityResponse, auth.ts:138-158). argon2id params: memory 19MiB+, t=2, p=1 baseline, tunable via env, with a needs-rehash check on successful login.

(2) SESSIONS replace the single rotating cookieToken. New `sessions` table: id, user_id, token_hash (sha256 of an opaque 32B base64url secret — NEVER store raw), created_at, last_seen_at, expires_at, revoked_at, ip, user_agent, auth_method, oidc_provider. The signed cookie now carries a session secret (not users.cookieToken). This gives per-device logout, "log out everywhere", idle+absolute expiry, and an admin-visible session list — none of which the single-token model can do. users.cookieToken is retained ONLY as the nickname-mode fallback until that mode is removed. The Tauri client_devices bearer rail is unchanged conceptually (it is already a per-device hashed long-lived token) but is unified under the same session/credential authz; device registration in password mode requires a valid session first (already true: client-devices/register calls resolveCurrentUser).

(3) FIRST-ADMIN BOOTSTRAP replaces the shared ADMIN_CLAIM_SECRET. On an empty users table (or zero isAdmin users), the first password registration is promoted to admin atomically (SELECT count WHERE is_admin AND deleted_at IS NULL ... INSERT ... in one tx with an advisory lock to avoid a race). After bootstrap, admins are created by INVITE only; ADMIN_CLAIM_SECRET is deprecated (still honored in nickname/hybrid mode for back-compat, removed when nickname mode is dropped).

(4) ACCOUNT LIFECYCLE. New `user_invites` table (token_hash, email, invited_by, role, expires_at, accepted_at) → admin POSTs an invite, invitee accepts by setting a password (consumes invite). Deactivate = set users.deletedAt (the half-built soft-delete finally gets a writer) + revoke all sessions + revoke all client_devices, fail-closed everywhere (reads already filter deletedAt). Offboard = deactivate + rename nickname to `_deleted_<id>` (the reserved prefix from auth.ts:101 is finally used) to free the unique nickname while preserving FK history (FKs are mostly ON DELETE set null/restrict, so hard-delete is unsafe — soft-delete is correct).

(5) OIDC ABSTRACTION. A provider-registry mirroring the existing LLM provider pattern (env.ts:66-78 enum-gated registry). New `OidcProvider` interface {id, authorizationUrl(state,nonce,pkce), exchangeCode(code), fetchUserInfo()} with built-in google/microsoft/github adapters selected by env. Flow: GET /api/auth/oidc/:provider/start → set signed, short-lived state+nonce+PKCE-verifier cookie, 302 to provider. GET /api/auth/oidc/:provider/callback → verify state, exchange code (PKCE), validate id_token (iss/aud/exp/nonce), upsert by (provider, sub) into new `user_identities` table (provider, subject, user_id, email), link or create the user, mint a session, redirect to app. Account-linking policy (link by verified email vs always-new) is configurable and surfaced as an open question. OIDC is just another way to mint a session — the session/authz model below it is identical.

The shared @workhub/api-client (types.ts:185) gains login/register/oidcStart methods; web uses cookie sessions, desktop continues to exchange a session for a long-lived device token (client-devices/register) so the daemon stays headless. CORS allowHeaders and the CSRF same-origin guard must whitelist the OIDC callback (it's a top-level navigation: Sec-Fetch-Site is fine, but it's a GET so the guard already passes; the callback must be CSRF-state-protected by the state cookie, not the same-origin guard).

## 数据库迁移（新表/列/索引）

- New table `user_credentials`: id uuid pk, user_id uuid notnull references users(id) on delete cascade, email citext (requires `CREATE EXTENSION IF NOT EXISTS citext`), password_hash varchar(255) (PHC string), password_algo varchar(32) default 'argon2id', password_updated_at timestamptz, failed_attempts int default 0, locked_until timestamptz, timestamps. uniqueIndex user_credentials_user_id_uq on (user_id); partial uniqueIndex user_credentials_email_uq on (lower(email)) WHERE deleted_at IS NULL — model email uniqueness the same way users_nickname_uq is partial (core.ts:64).
- New table `sessions`: id uuid pk, user_id uuid notnull references users(id) on delete cascade, token_hash varchar(64) notnull, auth_method varchar(16) notnull ('password'|'oidc'|'nickname'), oidc_provider varchar(32), created_at, last_seen_at, expires_at timestamptz notnull, revoked_at timestamptz, ip varchar(64), user_agent varchar(256). uniqueIndex sessions_token_hash_uq on (token_hash); index on (user_id), partial index on (user_id) WHERE revoked_at IS NULL for 'logout everywhere' and active-session listing; index on expires_at for sweeper.
- New table `user_identities` (OIDC link): id uuid pk, user_id uuid notnull references users(id) on delete cascade, provider varchar(32) notnull, subject varchar(255) notnull, email citext, email_verified boolean, timestamps. uniqueIndex user_identities_provider_subject_uq on (provider, subject).
- New table `user_invites`: id uuid pk, token_hash varchar(64) notnull, email citext notnull, invited_by_user_id uuid references users(id) on delete set null, role varchar(16) notnull default 'member', expires_at timestamptz notnull, accepted_at timestamptz, accepted_user_id uuid references users(id) on delete set null, timestamps. uniqueIndex on token_hash; partial uniqueIndex on (lower(email)) WHERE accepted_at IS NULL to prevent duplicate open invites.
- Alter `users`: add deleted_by_user_id uuid references users(id) on delete set null (matches the softDeleteColumns() convention already used by other tables, core.ts:38-41) so offboard records who did it. Add availability is unaffected. No change to cookie_token (kept for nickname-mode fallback).
- All four new tables get a single new numbered migration file (e.g. 0022_auth_credentials_sessions.sql) authored as raw SQL with a matching meta/_journal.json entry — runtime CREATE TABLE/ALTER TABLE is forbidden by scripts/dev/check-migrations.ts:52-57. Use CREATE TABLE IF NOT EXISTS + IF NOT EXISTS indexes (idempotent, matches 0019/0021 style). Note the known snapshot-regen gap: regenerate or hand-maintain meta snapshot chain consistent with prior migrations.
- Optional later migration to DROP users.cookie_token + its partial-unique index once nickname mode is fully retired (final phase only).

## 实施阶段（可独立交付，每阶段带测试门）

### Phase 1：Phase 0 — Session table + AUTH_MODE flag, behavior-identical

Introduce the `sessions` table and a SessionRepository, and add AUTH_MODE env (default 'nickname'). Refactor issueUserCookie/readCookieToken/resolveCurrentUser (apps/api/src/middleware/auth.ts:116-268) so that when AUTH_MODE!='nickname' the cookie carries a session secret resolved via sessions.token_hash, but in 'nickname' mode it still uses users.cookieToken. No user-visible change yet: /identify, /logout, /me, client-devices all keep working. Wire the new repo into getDefaultAuthDependencies (auth.ts:65-74) and the AuthDependencies type (auth.ts:52-59). Add a session sweeper for expired rows. This de-risks everything downstream by landing the session primitive first.

- **涉及文件**：packages/db/src/schema/core.ts, packages/db/migrations/0022_auth_sessions.sql, packages/db/src/repositories/sessions.ts, packages/db/src/repositories/index.ts, packages/config/src/env.ts, apps/api/src/middleware/auth.ts, apps/api/src/routes/auth.ts
- **测试门**：Unit (node --test) with a MemorySessions fake mirroring auth.test.ts MemoryUsers (auth.test.ts:68): assert nickname mode is byte-identical to today and session mode mints/rotates/expires/revokes correctly. New PG smoke apps/api/src/qa/auth-session-pg-smoke.ts: against real PG, create session → resolve by cookie → revoke → assert 401; assert expired session rejected and partial index lists only active sessions.

### Phase 2：Phase 1 — Password credentials: register + login + first-admin bootstrap

Add `user_credentials` table, argon2id hashing util (constant-time, needs-rehash on login, lockout via failed_attempts/locked_until reusing the throttle discipline from admin-claim-throttle.ts), and a CredentialsRepository. New endpoints POST /api/auth/register {email,password,nickname} and POST /api/auth/login {email,password} that mint a Phase-0 session. First-admin bootstrap: registration into an empty/zero-admin users set is promoted to isAdmin in one tx with an advisory lock (replace shared-secret claim). Gate all new endpoints behind AUTH_MODE in ('password','hybrid'); ADMIN_CLAIM_SECRET path stays only for nickname/hybrid. Add contracts schemas (registerRequest/loginRequest) to packages/contracts/src/auth.ts.

- **涉及文件**：packages/db/src/schema/core.ts, packages/db/migrations/0023_user_credentials.sql, packages/db/src/repositories/credentials.ts, apps/api/src/lib/password.ts, apps/api/src/routes/auth.ts, packages/contracts/src/auth.ts, packages/config/src/env.ts
- **测试门**：Unit: argon2id verify roundtrip, wrong-password rejection, lockout after N failures, needs-rehash detection; register/login route tests with in-memory fakes; first-admin-bootstrap promotes first user and NOT the second. PG smoke auth-password-pg-smoke.ts: real register→login→session→/me; duplicate-email rejected by partial-unique; concurrent first-admin race promotes exactly one (advisory lock).

### Phase 3：Phase 2 — Per-device logout, session listing, password change

Make logout revoke only the current session (apps/api/src/routes/auth.ts:145-166 currently rotates the global cookieToken). Add GET /api/auth/sessions (list active), POST /api/auth/sessions/:id/revoke, POST /api/auth/logout-all, POST /api/auth/change-password (rehash + revoke other sessions). Keep desktop client_devices revoke flow (client-devices.ts:66-93) working and unify it so revoking a device also revokes its sessions. Surface session list in the web account UI.

- **涉及文件**：apps/api/src/routes/auth.ts, packages/db/src/repositories/sessions.ts, packages/contracts/src/auth.ts, apps/web/src/browser.ts
- **测试门**：Unit: logout revokes only current session, logout-all revokes all, change-password invalidates siblings. PG smoke: two sessions for one user; revoke one → other still valid → logout-all → both 401. Re-run web smoke (qa:r4-web-* / live-route) since browser.ts changed (CJK overflow gate per memory).

### Phase 4：Phase 3 — Account lifecycle: invite / deactivate / offboard / soft-delete writer

Add `user_invites` table + flow: admin POST /api/auth/invites {email,role}, invitee GET/POST /api/auth/invites/:token/accept (sets password, consumes invite). Add the missing soft-delete WRITER: admin POST /api/users/:id/deactivate sets users.deletedAt + deleted_by_user_id, revokes all sessions and client_devices; offboard additionally renames nickname to `_deleted_<id>` (frees the partial-unique nickname, honors the reserved prefix at auth.ts:101). Add UserRepository.deactivate/offboard + reactivate. Admin-only via existing isAdmin authz (packages/permissions/src/resource-permissions.ts).

- **涉及文件**：packages/db/src/schema/core.ts, packages/db/migrations/0024_user_invites_and_deleted_by.sql, packages/db/src/repositories/users.ts, packages/db/src/repositories/invites.ts, apps/api/src/routes/auth.ts, apps/api/src/routes/users.ts, apps/api/src/app.ts, packages/contracts/src/auth.ts
- **测试门**：Unit: invite create→accept→consumed (can't reuse); deactivate revokes sessions+devices and subsequent auth is 401/403; offboard frees nickname for re-registration; non-admin gets 403. PG smoke auth-lifecycle-pg-smoke.ts: full invite→accept→deactivate→re-register-same-nickname against real PG (validates the partial-unique tombstone fix from migration 0021/M18 actually works with a real writer).

### Phase 5：Phase 4 — Pluggable OIDC (Google/Microsoft/GitHub)

Add the OidcProvider registry (mirror env.ts:66-78 enum-gated provider pattern) with google/microsoft/github adapters. Endpoints: GET /api/auth/oidc/:provider/start (signed short-lived state+nonce+PKCE cookie, 302 to IdP) and GET /api/auth/oidc/:provider/callback (verify state, PKCE code exchange, id_token validation iss/aud/exp/nonce, upsert user_identities by (provider,subject), link/create user, mint session, redirect). Add `user_identities` table. Ensure CORS allowHeaders (app.ts:62) and the CSRF guard (csrf.ts) permit the callback (GET top-level nav, protected by state cookie not same-origin). Add provider config env (client id/secret/issuer/redirect) with production validation. Web onboarding gains 'Sign in with' buttons (browser.ts).

- **涉及文件**：packages/db/src/schema/core.ts, packages/db/migrations/0025_user_identities.sql, packages/db/src/repositories/user-identities.ts, apps/api/src/auth/oidc/registry.ts, apps/api/src/auth/oidc/providers.ts, apps/api/src/routes/auth.ts, apps/api/src/app.ts, packages/config/src/env.ts, apps/web/src/browser.ts
- **测试门**：Unit with a mock IdP (stub authorizationUrl/exchangeCode/userinfo): full start→callback mints a session; state mismatch/nonce mismatch/expired code rejected (403); existing-subject re-login reuses the same user; account-linking-by-email follows the configured policy. PG smoke auth-oidc-pg-smoke.ts: callback upserts user_identities and creates/links a real user + session against PG. Re-run web smoke for the onboarding change.

### Phase 6：Phase 5 — Default to password mode, retire shared secret + nickname fallback

Flip AUTH_MODE default to 'password' (or 'hybrid' for staged pilots), add a backfill/migration path that prompts existing nickname users to set a password (one-time link via the invite mechanism), and document the cutover in docs/workhub. Once all pilot users have credentials, deprecate ADMIN_CLAIM_SECRET and the in-process admin-claim-throttle, and (final step) drop users.cookie_token + its index. Update README doc-count gate and DEPLOY.md.

- **涉及文件**：packages/config/src/env.ts, apps/api/src/routes/auth.ts, apps/api/src/middleware/auth.ts, packages/db/migrations/0026_drop_cookie_token.sql, docs/workhub/auth-cutover.md, README.md
- **测试门**：Full lint (pnpm verify→lint→qa:r2-release-gate) green; all auth PG smokes from phases 0-4 green in password-default mode; nickname-mode unit tests removed in lockstep with the flag flip; verify-ci-job-conclusions discipline (gh run view --json jobs) since this touches the release gate.

## 风险

- Session-cookie swap is the highest-risk refactor: resolveCurrentUser/resolveStreamUser/issueUserCookie (auth.ts:116-324) are on every authenticated request AND on SSE streams. A regression logs everyone out or, worse, mis-resolves identity. Phase 0 keeps it behavior-identical behind the flag specifically to isolate this.
- argon2id is CPU/memory heavy; default node single-thread API process (WORKER_COUNT default 1, env.ts:40) could be DoS'd by login floods. Need per-IP/email rate limiting on /login and tuned params; the existing admin-claim-throttle is single-process only and won't scale to multi-worker (its own comment says use Redis).
- Migration snapshot-regen gap (called out in repo): four new tables across phases risk a broken drizzle meta snapshot chain that passes locally but breaks drizzle introspection. Hand-author SQL + journal carefully and run audit:migrations.
- Email as new identity axis collides with existing nickname-keyed code: many tables denormalize nickname (work_items.claimedByNickname, comments.authorNickname, projects.ownerNickname). Offboard's nickname rename must not orphan these denormalized strings or break display.
- OIDC account-linking by email is a classic account-takeover vector if email_verified isn't enforced (e.g. GitHub unverified emails). Must require verified email before auto-linking, else create a distinct account.
- CSRF guard (csrf.ts) treats presence of the client-token header as bearer auth and skips origin checks; if password sessions ever start being sent with a stray client-token header, the guard is bypassed. Keep the two rails strictly separate.
- Desktop daemon is headless (Rust, config.client_token in http.rs) — it cannot do an interactive password/OIDC browser flow itself. It must continue to bootstrap via a session-minted device token; breaking client-devices/register breaks all desktop auth.

## 向后兼容（滚动迁移期不破现有流程）

["AUTH_MODE env flag defaults to 'nickname' through phases 0-4, so /identify and the shared ADMIN_CLAIM_SECRET keep working unchanged for the entire pilot until the explicit Phase-5 cutover. 'hybrid' mode runs both rails simultaneously for staged migration.", "Phase 0 makes the session refactor a no-op in nickname mode: users.cookie_token remains the cookie payload until password mode is active, and is only dropped in the final Phase-5 migration after all users have credentials.", "Desktop X-WorkHub-Client-Token / X-YQGL-Client-Token bearer rail (http.rs:5-6, auth.ts:219-241) is untouched in mechanism — it's already a per-device hashed long-lived token. New auth modes mint sessions; the device-token exchange (client-devices/register) keeps the daemon working without code changes on the Rust side.", "All new endpoints (register/login/invites/oidc/sessions) are additive and flag-gated; existing routes, contracts response shapes (toIdentityResponse auth.ts:138-158, /me auth.ts:108-127), and the @workhub/api-client interface (types.ts:185-188) keep their current shapes — new methods are added, none changed.", "Soft-delete reads already filter deletedAt===null everywhere (repositories/users.ts), so adding the deactivate WRITER is safe — existing code already expects deactivated users to disappear; it just never had a way to produce that state.", "The first-admin bootstrap only activates on an empty/zero-admin users table, so existing pilots that already claimed an admin via the shared secret are unaffected; ADMIN_CLAIM_SECRET stays honored in nickname/hybrid mode."]

## 待决策（Open Questions — 实施前/中需用户拍板）

1. Email verification: do we require email-confirmation on password registration, or trust-on-first-use for the LAN pilot? (Affects whether we need an email-sending integration, which the codebase currently has none of.)
2. OIDC account-linking policy: auto-link an OIDC login to an existing password account when the verified email matches, or always create a separate account and require explicit linking? (Security vs UX tradeoff.)
3. Which OIDC providers ship in the first cut — all three (Google/Microsoft/GitHub) or just one? GitHub's email handling (unverified/private emails) needs special care.
4. Identity primary key going forward: stay nickname-display + email-login, or migrate the canonical identifier to email and demote nickname to pure display? This affects the many nickname-denormalized columns.
5. Session lifetime policy: absolute expiry, idle/sliding expiry, or both, and what durations? Current cookie is 1 year (auth.ls auth.ts cookieMaxAgeSeconds).
6. Is there an email/SMTP delivery channel available for invites and password-reset, or must invites be delivered out-of-band (admin copies a link) like the current device-token registration?
7. Password reset / forgot-password flow: in scope for this epic, or deferred? It depends on the email-delivery decision.
8. Multi-worker/multi-instance deployment target: the admin-claim-throttle and any login rate-limiter are in-process only today. Does the pilot stay single-process (LAN) or do we need Redis-backed throttling now?
9. Should existing nickname-only accounts be force-migrated to passwords at Phase-5 cutover (blocking login until they set one), or grandfathered in hybrid mode indefinitely?

## 用户已拍板（2026-06-18）—— 上面 open questions 的部分定论

- **#1 邮件验证 / #6 邮件投递 / #7 密码重置**：**out-of-band 链接，无 SMTP**。email 存但不验证（trust-on-first-use），邀请/重置链接由管理员手动分发；不引入邮件发送集成。
- **#3 OIDC 范围**：**password-first**——先做密码+会话+生命周期；OIDC 抽象层落地但首版接 **0 个 provider**。
- **#8 部署形态**：**暂单 API 进程**（LAN pilot），登录限流/admin-claim-throttle 维持 in-process，不强制 Redis 化。
- **#4 身份主键**：保留 **nickname 作 display + email 登录**（additive，不迁主键），避免触动大量 nickname-denormalized 列。
- **#5 会话生命周期**：**绝对过期 + 滑动过期双控**（schema 已含 `absolute_expires_at` + `idle_expires_at`），具体时长在会话仓库阶段定。
- **#2 OIDC 账号关联 / #9 强制迁移**：留待 OIDC（Phase 4）/ 切换（Phase 5）阶段实施前再定。

## 进展（2026-06-18）

### ✅ Phase 1（安全 schema 地基）已完成、全 7 CI 绿 —— 纯 schema/迁移门，零运行时行为变化

与原子预算 epic 同范式：先落「不接线」的安全数据底座，typecheck/迁移门把关，中间件仍走 nickname `cookieToken`，无任何请求路径行为变化。

- **新表 `user_credentials`**（`packages/db/src/schema/core.ts`）：每用户至多一份口令记录（`user_id` unique）；`password_hash`（argon2id PHC 串，可空=仅 OIDC/未设密码）、`password_algo`（便于将来无停机轮换哈希算法）、`email_verified_at`（out-of-band trust-on-first-use，可空）、`failed_attempts`/`locked_until`（登录锁定地基）。**`email` 用 citext**——大小写不敏感唯一与等值匹配，免应用层处处 `LOWER()`；drizzle 侧声明 `varchar` 即可（citext 与 text 兼容，`eq()` 生成的 `email = $1` 天然大小写不敏感）。
- **新表 `sessions`**：服务端会话替代单 `cookieToken`。`token_hash`=sha256(session secret)（绝不存明文，唯一索引）；`auth_method`（password|oidc|nickname）+ `oidc_provider`；`absolute_expires_at`（硬上限）+ `idle_expires_at`（滑动，partial 过期清扫索引仅扫未撤销行）；`revoked_at` 墓碑用于登出/停用批量撤销；`ip_hash`/`user_agent` 可选审计。
- **`users` 加列 `deleted_by_user_id`**（自引用 set null，与其余 soft-delete 表 `softDeleteColumns()` 约定一致）——offboard/停用审计地基。
- **手写迁移 `0023_auth_credentials_sessions.sql`** + journal idx:23：`CREATE EXTENSION IF NOT EXISTS citext`（官方 postgres 镜像含此 contrib）+ 两表 + 全部索引 + `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by_user_id`。`pnpm audit:migrations` 通过（不污染 snapshot 链，止于 0015）。
- **测试**：`packages/db/src/schema.test.ts` 加两条——断言两表列契约 + 读 0023 迁移文件断言 citext/唯一索引/partial index/users ALTER 落实（mirror 既有 drive-tables 迁移内容测）。新 nullable 必填列 `deletedByUserId` 触发 13 处测试 user 假数据补 `deletedByUserId: null`（userMemories 行不受影响——该表只有 `deletedAt` 无 `deletedByUserId`）。
- **验证齐绿**：`pnpm -r typecheck`（16 包）、`pnpm audit:migrations`、`@workhub/db` 24 测、`@workhub/api` 246 测全过；PG smoke 在 CI 应用 0023 迁移。
- **registry 决策**：`workHubTables`（schema.test.ts 的 F02 count gate=50）保持不变——遵循原子预算 epic 把 `budget_reservations` 留在 registry 外的先例，新运营表只 `export const` 不进 F02「计划图」清单，不动 count gate。

设计原 Phase 0 把会话表与中间件 cookie 互换捆在一起；本实施**刻意拆开成三刀**，逐刀 CI-gated：
**①schema 地基**（已完成）→ **②SessionRepository 数据访问层**（已完成）→ **③AUTH_MODE 中间件 cookie 互换**（已完成，最高爆炸半径，单独一刀）。三刀均零运行时行为变化（nickname 默认模式逐字节不变）。

### ✅ Phase 2a（SessionRepository 数据访问层）已完成、全 CI 绿 —— 仍零运行时行为变化（未接线）

与原子预算 `budget-reservations` 仓库同范式：先落不接线、可单测的数据访问层，中间件仍走 nickname `cookieToken`。

- **`packages/db/src/repositories/sessions.ts`**（`createSessionRepository(db)`）：`create` / `findActiveByTokenHash(hash, now)`（未撤销 ∧ 绝对未过期 ∧ 滑动未过期，SQL 层 `gt` 过滤）/ `touch`（滑动续期 idle + last_seen，guard `revoked_at IS NULL` 不复活墓碑）/ `revoke`（单会话登出）/ `revokeAllForUser`（全设备登出 / 停用批量撤销）/ `deleteExpired`（硬删绝对过期死会话，墓碑保留作短期审计）。与 `devices` 仓库一致——仓库只认 `token_hash`，明文 secret 永不落库。
- **纯函数（无 DB，可单测）**：`generateSessionToken`（base64url 48 字节熵，mirror `makeClientToken`）/ `hashSessionToken`（sha256 hex，mirror `hashClientToken`）/ `isSessionActive(row, now)` / `nextIdleExpiry(now, idleTtlMs, absolute)`（滑动永不越过绝对硬上限）。
- **测试**：`packages/db/src/sessions-repository.test.ts` 4 测覆盖全部纯函数（hash 确定性/不泄明文、token 高熵且每次不同、有效性四条件 + 边界、滑动夹绝对上限）。DB 方法待接线阶段由 PG smoke 覆盖。导出经 `packages/db/src/index.ts`。
- **验证**：`pnpm -r typecheck`（16 包，无符号碰撞）+ `@workhub/db` 28 测全绿。

### ✅ Phase 2b（AUTH_MODE 中间件 cookie 互换）已完成、全 CI 绿 —— nickname 默认逐字节不变

最高爆炸半径的一刀，靠**默认 off 的旗标**把风险关进笼子：`AUTH_MODE='nickname'`（默认）下新代码路径一行不进，行为与历史完全一致。

- **配置**（`packages/config`）：新增 `AUTH_MODE`（enum nickname|hybrid|password，默认 nickname）+ `SESSION_ABSOLUTE_TTL_HOURS`（默认 720=30 天硬上限）+ `SESSION_IDLE_TTL_HOURS`（默认 168=7 天滑动）→ `settings.auth.{authMode,sessionAbsoluteTtlMs,sessionIdleTtlMs}`。
- **读路径**（`auth.ts` `resolveCurrentUser`/`resolveStreamUser`，每请求 + SSE 流都过）：抽出 `resolveUserFromCookie(deps, cookieToken, now)`——`nickname` 模式直接 `findActiveByCookieToken`（与历史逐字节一致）；`password`/`hybrid` 模式把 cookie 当会话 secret，经 `SessionRepository.findActiveByTokenHash(hashSessionToken(secret), now)` 解析并**滑动续期**（`touch` 推后 idle，永不越过绝对上限）；`password` 纯会话不回退、`hybrid` 解析不到回退 cookieToken（迁移期）。
- **写路径**（备 login 阶段用，本刀仅测试驱动，生产 nickname 模式不触发）：`mintSession(deps, user, opts)`（生成 secret、算绝对/滑动过期、落 `sha256(secret)`）+ `issueSessionCookie(c, token)`（signed cookie 载明文 secret，maxAge=绝对 TTL）。
- **依赖注入**：`AuthDependencies.sessions?` 设为 OPTIONAL（与原子预算 `reservationRepo` 同范式——单测不传则会话路径不参与）；`getDefaultAuthDependencies` 注入 `createSessionRepository(db)`。
- **测试**：`auth.test.ts` + 7 测（password 解析+滑动 / 拒绝撤销+过期 / 纯会话忽略 cookieToken / **nickname 默认忽略会话 cookie 证明门关着** / hybrid 双通 / issueSessionCookie 端到端往返 / resolveStreamUser 会话解析）。`@workhub/api` 253 测 + `@workhub/config` 11 测 + `pnpm -r typecheck`(16 包)全绿。

### ✅ Phase 3a（口令哈希器 + CredentialRepository）已完成、全 CI 绿 —— 仍零路由接线

密码基线的两块安全原语，仍不接线（无注册/登录路由），可单测 + 待业务路由调用。

- **`apps/api/src/auth/password.ts`**：`hashPassword`（生成 PHC 自描述串）/ `verifyPassword`（常量时间，任何解析失败/算法不认识/不匹配都返 false 不抛）/ `needsRehash`（参数弱于当前或不可解析→该透明升级）/ `validatePassword`（长度区间 8–1024，越界抛 `WeakPasswordError`）/ `currentPasswordAlgo`。
  - **算法决策（偏离设计稿，刻意）**：设计点名 argon2id，本实施改用 **node 内置 `scrypt`**（内存硬、零依赖、glibc/musl 无关）——避免在自动循环里引入原生依赖（`@node-rs/argon2` 的预编译二进制要靠 Docker 构建的 pilot-stack-smoke 才验证得到，风险不该无人值守时担）。PHC 串自带 `$scrypt$ln=15,r=8,p=1$salt$hash`，`password_algo` 列 + `needsRehash` 留好**无停机轮换钩子**：日后注册 argon2id 实现，旧 scrypt 串靠 algo 标签继续验、登录时透明升级，无需迁移。参数 N=2^15(~32MB/次)、r=8、p=1、keylen=32、salt 16B；scrypt 异步不阻塞事件循环。
- **`packages/db/src/repositories/user-credentials.ts`**（`createCredentialRepository`）：`findByEmail`(citext 大小写不敏感) / `findByUserId` / `createCredential` / `updatePassword`(改密清零失败计数+解锁) / `recordFailedAttempt`(计数+1+可选锁定) / `resetFailedAttempts` / `setEmailVerified`。仓库只存/读已哈希 PHC 串，策略无关。经 `index.ts` 导出。DB 方法待接线由 PG smoke 覆盖。
- **测试**：`apps/api/src/password.test.ts` 4 测（PHC 格式+随机 salt / 校验对错+篡改+垃圾串不抛 / 长度策略 / needsRehash 判弱参与未知算法）。`@workhub/api` 257 测 + `@workhub/db` 28 测 + `pnpm -r typecheck`(16 包)全绿。
- **✅ 真 PG 覆盖（`r2-pg-redis-smoke`）**：凭据 + 会话 DB 层（2a/3a 仓库此前仅假数据单测）首次过真 Postgres——`createCredential`→`findByEmail`(大写 email 验 **citext 大小写不敏感**)→`verifyPassword`(对/错)→失败计数+复位；会话 `create`→`findActiveByTokenHash`→`touch` 滑动→`revoke`(解析不到)→绝对过期 `deleteExpired` 清扫→`revokeAllForUser` 全撤。补上了 DB 方法的真库验证缺口。

### ✅ Phase 3b（密码注册/登录/登出路由）已完成、全 CI 绿 —— 首个**行为性**改动（AUTH_MODE 门控，nickname 默认不暴露）

密码认证的实际功能，建在 3a/3b 已 PG 验证的原语上。全部 `AUTH_MODE!='nickname'` 门控：nickname 默认模式下三个路由 404、零现状改动。

- **`POST /api/auth/register`**：`passwordRegisterRequestSchema`(email/password/nickname) → `validatePassword` → email 唯一预检(409) → 建 user(`isAdmin` 由**首管引导**决定：`hasAnyActiveAdmin()===false` 即首个注册者置 admin，取代 ADMIN_CLAIM_SECRET) → `createCredential`(`hashPassword`) → `mintSession`+`issueSessionCookie` → 201。昵称/邮箱并发竞态由 `isUniqueViolation`(23505)→409 兜底。
- **`POST /api/auth/login`**：`findByEmail` → 锁定检查(`lockedUntil>now`→429) → `findActiveById`(软删用户→401) → `verifyPassword`；失败 `recordFailedAttempt`(连续 ≥10 次置 15 分钟 `lockedUntil`)+**统一 401 不泄露 email 是否存在**；成功 `resetFailedAttempts`+按 `needsRehash` 透明升级哈希 → `mintSession`+`issueSessionCookie` → 200。
- **`POST /api/auth/logout`**：会话模式额外 `sessions.findActiveByTokenHash`→`revoke` 当前会话墓碑（nickname 模式维持原状删 cookie）。
- **接线**：`AuthDependencies.credentials?` OPTIONAL + `getDefaultAuthDependencies` 注入 `createCredentialRepository`；`UserRepository.hasAnyActiveAdmin?()` OPTIONAL（假仓库不实现则不自举）。`route-auth-posture` fail-closed 门把 register/login 列入公开入口白名单。
- **测试**：`auth.test.ts` +6 测（首管自举+会话 cookie 往返 / 已有 admin 不自举+重复邮箱 409 / nickname 模式 404 / 登录对错 401+失败计数 / 未知邮箱 401+锁定 429 / 登出撤销会话）。`@workhub/api` 263 测 + `@workhub/db` 28 + `@workhub/contracts` 42 + `pnpm -r typecheck`(16 包) + `route-auth-posture` fail-closed 门全绿。OpenAPI 补 register/login 条目。

### ⏭️ 之后（依设计推进，本刀未含）

- **✅ 会话清扫调度（已完成）**：`apps/api/src/workers/session-sweep.ts`（`createSessionSweepScheduler`，mirror agent-run-recovery：`tick`→`sessions.deleteExpired`、unref 定时器、`.start/.stop/.stats`）；`server.ts` 仅 `AUTH_MODE!='nickname'` 时启动（nickname 模式不签发会话→不清扫）。单测直测 `tick()`（删除计数+错误记录，无定时器不挂起）。`@workhub/api` 268 测全绿。
- **生命周期**：**✅ 停用 + 改密已完成**。
  - 停用：`POST /api/auth/users/:id/deactivate`（管理员；软删用户 `users.softDelete`+记 `deleted_by_user_id`、`sessions.revokeAllForUser`、逐设备 revoke、forget presence；防呆禁停用自己 400、非管理员 403、任意 AUTH_MODE 通用）。
  - 改密：`POST /api/auth/password`（已登录用户旧密码换新；`findByUserId`→`verifyPassword`(错→403)→`validatePassword`→`updatePassword`→`revokeAllForUser`(撤其它设备)+`mintSession`(当前不掉线)；AUTH_MODE 门控 404。**坑：鉴权必须先于「功能未启用」404——否则未鉴权请求被 404 抢先，route-auth-posture fail-closed 门会红；已修为 resolveCurrentUser 先行 401**）。
  - **⏭️ 待做**：邀请（out-of-band 链接，需 user_invites 表）/offboard（昵称改名释放唯一）。
- **OIDC**：provider 抽象层（接 0 provider 占位）。
- **前端**：web onboarding 注册/登录屏（password 模式）、桌面端会话适配。
- **Phase 5 切换**：AUTH_MODE 默认翻 password、退役 ADMIN_CLAIM_SECRET、最终删 `users.cookie_token`。
