# WorkHub Batch 0 Desktop Identity and SSE Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Desktop logout and rebind a confirmed identity boundary across Spotlight, Tauri/Rust, API SSE, and Cuu so an A-user stream or restored card cannot survive logout or appear after binding B.

**Architecture:** The interactive macOS client uses one identity authority: an explicitly activated device token installed through a versioned Rust identity coordinator and Rust-owned crash-durable private identity store. Desktop bootstrap first fsyncs a high-entropy attempt handle, the API mints an unauthenticated pending attempt, Rust fsyncs that credential quarantine, and only then may the client activate it; Web Storage remains only a legacy-migration/plain-browser adapter and is not native crash evidence. Rust prepare cancels and acknowledges the old generation, Pet prepare proves old private work is gone, canonical storage and Rust commit are staged while effects remain blocked, Pet commit starts the new scope, and only Rust finalize releases workers. API streams perform transaction-locked reauthorization+write so revocation commit serializes against every frame.

**Tech Stack:** TypeScript, Node test runner, Hono streaming, PostgreSQL-backed auth repositories, Tauri 2, Rust, Tokio `watch`/async coordination, reqwest SSE, WorkHub API client, Cuu controller.

## Global Constraints

- Preserve the LAN-first single-deployment Pilot target on macOS, Web, Tauri, and Cuu.
- Fail fast: no `.catch(() => undefined)`, silent lock-poison handling, or identity fallback on logout/rebind paths.
- Do not represent a broadcast request as proof that a stream actually stopped.
- Never log a token, token prefix, token suffix, cookie, full private card, or full transcript.
- Every real identity change durably reserves a monotonically increasing cross-process `u64` generation before broadcast; the counter is also bounded by JavaScript `Number.MAX_SAFE_INTEGER`. Missing/corrupt/unwritable counter state blocks identity startup or transition with a stable error, and unused crash gaps are allowed but reuse/rollback is not.
- One main-window transition lease serializes Rust prepare, worker barrier, Pet prepare ack, local persistence, Rust commit mark, Pet commit/ready ack, and Rust finalize; no second clear/bind may begin while that lease is active. Abort/fail-closed recovery keeps a clear lease until Pet clear ack or confirmed surface destruction. The lease is bounded and every mutation command verifies both the main-window owner and exact transition id.
- Public coordinator commands/events return only transition id, generation, status, actor id, phase, changed flag, worker counts, and lease duration. Separate surface-restricted private-store commands may return credentials only to main or the exact Pet transition handler; they never emit/log/report them.
- The ordinary-user release has one production token authority. `workhub-shell-config.json.client_token`, `WORKHUB_CLIENT_TOKEN`, and `YQGL_CLIENT_TOKEN` fail with `managed_identity_conflict`; deterministic Cuu QA tokens remain in `WORKHUB_CUU_QA_CLIENT_TOKEN`.
- A server logout failure is not a completed logout. Only `not_identified` or `invalid_client_token` may be treated as already absent.
- A desktop-bootstrap response never contains an already-active credential. Pending devices cannot authenticate any ordinary route, expire server-side, and require an acknowledged Rust-owned temp+fsync+rename+directory-fsync quarantine before explicit activation; Web Storage acknowledgement is never treated as crash durability.
- Identity-bound asynchronous work captures actor, generation, and abort signal; it must re-check that scope after every `await` and before every render, restore write, notification, action, or retry.
- Rust system notifications carry identity generation. Changing identity removes already-delivered WorkHub notifications, resets generation-scoped dedupe state, and rejects stale delivery and activation before any worker acknowledgement.
- Report signed out only after server revocation/already-absent, Rust cancellation acknowledgement, Pet prepare+commit acknowledgement (or confirmed Pet destruction), canonical signed-out persistence, and Rust finalization all complete.
- Existing audit history remains immutable. Remediation is appended to the living ledger; report-wide `HOLD` remains until every P1 is closed.
- Use TDD for every behavior change and record expected RED before GREEN.
- Each task gets an independent review; the whole batch gets a separate review. Fix every Critical and Important issue before merge.

---

## Contract and File Map

### Fixed public shapes

~~~rust
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellIdentityStatus {
    Bound,
    Cleared,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShellIdentitySnapshot {
    pub identity_generation: u64,
    pub status: ShellIdentityStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellIdentityPhase {
    Stable,
    Preparing,
    Committing,
    Recovering,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShellIdentityPublicRead {
    pub snapshot: ShellIdentitySnapshot,
    pub phase: ShellIdentityPhase,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellIdentityActiveTransitionPhase {
    Preparing,
    Committing,
    Recovering,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShellIdentityActiveTransitionRead {
    pub transition_id: String,
    pub phase: ShellIdentityActiveTransitionPhase,
    pub snapshot: ShellIdentitySnapshot,
    pub lease_remaining_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShellIdentityRead {
    pub snapshot: ShellIdentitySnapshot,
    pub phase: ShellIdentityPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_transition: Option<ShellIdentityActiveTransitionRead>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShellIdentityTransitionAck {
    pub transition_id: String,
    pub snapshot: ShellIdentitySnapshot,
    pub changed: bool,
    pub registered_workers: usize,
    pub acknowledged_workers: usize,
    pub dropped_workers: usize,
    pub lease_remaining_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ShellIdentityBeginOutcome {
    Prepared { transition: ShellIdentityTransitionAck },
    RecoveryRequired {
        recovery: ShellIdentityTransitionAck,
        reason_code: String,
    },
}
~~~

~~~ts
export type DesktopIdentitySnapshot = {
  identity_generation: number;
  status: "bound" | "cleared";
  actor_id?: string;
};

export type DesktopNativeIdentityRead = {
  snapshot: DesktopIdentitySnapshot;
  phase: "stable" | "preparing" | "committing" | "recovering" | "degraded";
  active_transition?: {
    transition_id: string;
    phase: "preparing" | "committing" | "recovering";
    snapshot: DesktopIdentitySnapshot;
    lease_remaining_ms: number;
  };
};

export type DesktopIdentityTransitionAck = {
  transition_id: string;
  snapshot: DesktopIdentitySnapshot;
  changed: boolean;
  registered_workers: number;
  acknowledged_workers: number;
  dropped_workers: number;
  lease_remaining_ms: number;
};

export type DesktopIdentityBeginOutcome =
  | { outcome: "prepared"; transition: DesktopIdentityTransitionAck }
  | {
      outcome: "recovery_required";
      recovery: DesktopIdentityTransitionAck;
      reason_code: string;
    };

export type DesktopIdentityChangeMessage = {
  change_id: string;
  phase: "prepare" | "commit";
  snapshot: DesktopIdentitySnapshot;
};

export type DesktopIdentityChangeAck = {
  change_id: string;
  surface: "pet";
  identity_generation: number;
  phase: "prepare" | "commit";
  ok: true;
};

export type DesktopIdentityChangeNack = {
  change_id: string;
  surface: "pet";
  identity_generation: number;
  phase: "prepare" | "commit";
  ok: false;
  reason_code:
    | "pet_identity_actor_mismatch"
    | "pet_identity_cleanup_failed"
    | "pet_identity_phase_conflict"
    | "identity_generation_conflict";
};

export type DesktopIdentityChangeResult =
  | DesktopIdentityChangeAck
  | DesktopIdentityChangeNack;

export type DesktopBootIdentity =
  | { state: "signed_out" }
  | { state: "needs_actor"; token: string }
  | { state: "bootstrap_pending"; attemptId: string; cancelSecret: string }
  | {
      state: "pending_activation";
      actorId: string;
      deviceId: string;
      token: string;
      attemptId: string;
      cancelSecret: string;
      pendingExpiresAt: string;
    }
  | { state: "interrupted_binding"; actorId: string; token: string; origin: "existing" }
  | {
      state: "interrupted_binding";
      actorId: string;
      deviceId: string;
      token: string;
      origin: "issued";
      attemptId: string;
      cancelSecret: string;
      pendingExpiresAt: string;
    }
  | { state: "bound"; actorId: string; token: string };
~~~

Stable reason codes:

~~~text
managed_identity_conflict
admin_secret_required
stored_identity_actor_mismatch
identity_generation_overflow
identity_generation_store_failed
identity_worker_ack_timeout
identity_required_worker_dropped
identity_transition_in_progress
identity_transition_lease_expired
identity_transition_wrong_surface
identity_generation_conflict
identity_recovery_failed
identity_state_poisoned
server_logout_failed
server_logout_timeout
server_logout_state_unknown
shell_identity_clear_failed
shell_identity_not_ready
pet_identity_ack_timeout
pet_identity_actor_mismatch
pet_identity_cleanup_failed
pet_identity_phase_conflict
pet_identity_operation_failed
pet_identity_storage_failed
pet_identity_surface_restart_failed
pet_identity_surface_destroy_failed
local_identity_persist_failed
local_identity_revision_conflict
local_identity_revision_overflow
local_identity_record_invalid
local_identity_legacy_cleanup_failed
interrupted_identity_binding
bootstrap_attempt_invalid
bootstrap_attempt_conflict
bootstrap_attempt_cancelled
bootstrap_attempt_generation_failed
bootstrap_attempt_cleanup_unknown
bootstrap_pending_device_expired
client_device_activation_failed
client_device_activation_state_unknown
token_cleared
stream_identity_changed
stream_auth_revoked
stream_auth_repository_failed
stream_auth_timeout
stream_auth_lock_timeout
stream_authorize_and_write_required
stream_authorization_transaction_unavailable
sse_stream_write_failed
stream_membership_unavailable
workspace_membership_required
workspace_membership_unavailable
system_notification_clear_failed
system_notification_delivery_unsettled
system_notification_sequence_overflow
notification_permission_missing
identity_qa_bundle_not_isolated
identity_qa_profile_not_isolated
identity_qa_data_store_failed
identity_qa_deep_link_not_isolated
identity_qa_api_base_mismatch
identity_qa_platform_unsupported
identity_qa_toolchain_failed
identity_qa_database_failed
identity_qa_proxy_failed
identity_qa_process_failed
identity_qa_notification_inspection_failed
identity_qa_route_mismatch
identity_qa_report_write_failed
identity_qa_secret_leak
identity_qa_timeout
identity_qa_artifact_incomplete
identity_qa_real_stream_missing
cuu_qa_identity_storage_failed
rebind_failed
rebind_timeout
rebind_rollback_incomplete
~~~

### Ownership

- Create `client-tauri/src-tauri/src/identity.rs`: private token state, public snapshot, generation notification, worker registration, and acknowledgement.
- Modify `client-tauri/src-tauri/src/sse_worker.rs`: race connect, active pump, and backoff against generation changes.
- Modify `client-tauri/src-tauri/src/sse.rs` and `notify.rs`: generation-tagged events and stale-generation rejection.
- Create `client-tauri/src-tauri/src/notification_lifecycle.rs`: an owned generation-scoped macOS notification backend, persistent activation delegate, submission/delivery barrier, selective cleanup, and dedupe.
- Modify `config.rs`/`http.rs`: reject the second production identity source and plan no static identity headers.
- Modify `apps/api/src/middleware/auth.ts`, `routes/push.ts`, and `sse/stream.ts`: no-touch reauthorization of already-open streams.
- Create `apps/desktop-webview/src/desktop-identity.ts` and `desktop-rebind.ts`: ordered logout/rebind and current Spotlight state.
- Modify Cuu runtime, Pet surface, shell event bridge, and Cuu controller: generation-bound direct stream, a full asynchronous quiescence barrier, and actor-scoped revalidated restore state.

---

### Task 1: Remove the second production token authority

**Files:**
- Modify: `client-tauri/src-tauri/src/config.rs:5-109`
- Modify: `client-tauri/src-tauri/src/http.rs:1-71`
- Modify: `client-tauri/src-tauri/src/sse.rs:117-145`
- Modify: `client-tauri/src-tauri/src/main.rs:1386-1410`
- Modify: `scripts/qa/cuu-tauri-linux-smoke.sh:954-966`
- Modify: `scripts/qa/cuu-tauri-motion-capture.ps1:2898-2910`
- Modify: `docs/workhub/05-clients/desktop-pet-tauri.md`
- Test: inline Rust tests in `config.rs`, `http.rs`, and `sse.rs`

**Interfaces:**
- Consumes: existing `WorkHubShellConfig`, `plan_daemon_request`, and explicit `WORKHUB_CUU_QA_CLIENT_TOKEN`.
- Produces: token-free shell config/request plan; Task 2 runtime injection becomes the only production source.

- [ ] **Step 1: Write failing conflict tests**

~~~rust
#[test]
fn rejects_client_token_from_config_file_for_interactive_release() {
    let result = load_shell_config_from_json_and_env(
        Some(r#"{"client_token":"legacy-a"}"#),
        |_| None,
    );
    assert_eq!(
        result,
        Err(WorkHubShellConfigLoadError::ManagedIdentityConflict {
            source: "workhub-shell-config.json.client_token".to_string(),
        })
    );
}

#[test]
fn rejects_client_token_from_environment_for_interactive_release() {
    let result = load_shell_config_from_json_and_env(None, |key| {
        (key == WORKHUB_CLIENT_TOKEN_ENV).then(|| "legacy-a".to_string())
    });
    assert_eq!(
        result,
        Err(WorkHubShellConfigLoadError::ManagedIdentityConflict {
            source: WORKHUB_CLIENT_TOKEN_ENV.to_string(),
        })
    );
}
~~~

Change request/SSE plan tests to assert zero static token headers:

~~~rust
assert!(plan.headers.is_empty());
assert!(subscription.headers.iter().all(|header| {
    header.name != WORKHUB_CLIENT_TOKEN_HEADER
        && header.name != LEGACY_CLIENT_TOKEN_HEADER
}));
~~~

- [ ] **Step 2: Run focused tests and record RED**

~~~bash
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml \
  rejects_client_token_from_config_file_for_interactive_release
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml \
  rejects_client_token_from_environment_for_interactive_release
~~~

Expected: compilation/test failure because `ManagedIdentityConflict` does not exist and static token headers are still planned.

- [ ] **Step 3: Implement fail-fast migration and token-free plans**

~~~rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkHubShellConfigLoadError {
    InvalidJson(String),
    ManagedIdentityConflict { source: String },
}

fn reject_managed_identity_source(
    source: &str,
    token: Option<String>,
) -> Result<(), WorkHubShellConfigLoadError> {
    if clean_optional(token).is_some() {
        return Err(WorkHubShellConfigLoadError::ManagedIdentityConflict {
            source: source.to_string(),
        });
    }
    Ok(())
}
~~~

Keep `client_token` only on the deserialization-only file shape so old files receive a precise migration error. Remove it from `WorkHubShellConfig`. Reject file field, branded env, then legacy env; never copy them into runtime config.

Update `load_workhub_shell_config` in `main.rs` to map both `InvalidJson` and `ManagedIdentityConflict` to stable reason-bearing startup errors; it must not format the new variant as an unclassified debug string.

~~~rust
pub fn plan_daemon_request(config: &WorkHubShellConfig, path: &str) -> ShellRequestPlan {
    ShellRequestPlan {
        url: daemon_url(config, path),
        headers: Vec::new(),
    }
}
~~~

Remove `WORKHUB_CLIENT_TOKEN` assignment/restoration from both QA launchers; retain `WORKHUB_CUU_QA_CLIENT_TOKEN`. Change the QA initialization script to write only the primary legacy `workhub_client_token` key (not `yqgl_client_token` and not Rust state), so Task 4's real one-time migration owns actor resolution/canonicalization. It must not keep its current empty `catch`: on shared-origin storage failure it throws/records only `cuu_qa_identity_storage_failed` (never the token), and native QA fails. Add a Rust string-contract test for this script. Document the user-facing migration and `managed_identity_conflict`.

- [ ] **Step 4: Run Rust/QA verification**

~~~bash
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml config::
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml http::
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml sse::
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml
rg -n 'WORKHUB_CLIENT_TOKEN|YQGL_CLIENT_TOKEN' \
  scripts/qa/cuu-tauri-linux-smoke.sh \
  scripts/qa/cuu-tauri-motion-capture.ps1
git diff --check
~~~

Expected: Rust commands exit `0`; `rg` exits `1`; diff check exits `0`.

- [ ] **Step 5: Commit**

~~~bash
git add client-tauri/src-tauri/src/config.rs \
  client-tauri/src-tauri/src/http.rs \
  client-tauri/src-tauri/src/sse.rs \
  client-tauri/src-tauri/src/main.rs \
  scripts/qa/cuu-tauri-linux-smoke.sh \
  scripts/qa/cuu-tauri-motion-capture.ps1 \
  docs/workhub/05-clients/desktop-pet-tauri.md
git commit -m "fix(desktop): enforce one interactive identity source"
~~~

---

### Task 2: Add a versioned Rust identity coordinator and acknowledged cancellation

**Files:**
- Create: `client-tauri/src-tauri/src/identity.rs`
- Create: `client-tauri/src-tauri/src/identity_store.rs`
- Modify: `client-tauri/src-tauri/src/lib.rs`
- Modify: `client-tauri/src-tauri/src/main.rs:476-502,1416-1505`
- Modify: `client-tauri/src-tauri/src/sse_worker.rs:19-245`
- Modify: `client-tauri/src-tauri/src/sse.rs:39-62,209-231`
- Modify: `client-tauri/src-tauri/src/notify.rs`
- Create: `client-tauri/src-tauri/src/notification_lifecycle.rs`
- Modify: `client-tauri/src-tauri/src/events.rs`
- Modify: `client-tauri/src-tauri/Cargo.toml`
- Modify: `client-tauri/src-tauri/Cargo.lock`
- Modify: `docs/workhub/04-modules/tasks-reminders-notifications.md`
- Modify: `docs/workhub/05-clients/desktop-pet-tauri.md`
- Create if absent / Modify: `AGENTS.md`
- Test: inline tests in the changed Rust modules

**Interfaces:**
- Consumes: token-free subscription from Task 1.
- Produces: `ShellIdentityCoordinator`, crash-durable private identity store with surface/phase-restricted commands, begin/mark/finalize/recover/get transition commands, main-only Pet surface restart/destroy recovery, generation-tagged shell/notification payloads, and a macOS notification cleanup barrier.

- [ ] **Step 1: Write failing coordinator tests**

~~~rust
#[tokio::test(flavor = "current_thread")]
async fn clear_increments_generation_and_wakes_registered_worker() {
    let coordinator = ShellIdentityCoordinator::default();
    let mut worker = coordinator.register_worker(IdentityWorkerKind::Sse).unwrap();
    let bound = coordinator
        .begin_transition(
            "main",
            Some("token-a".into()),
            Some("actor-a".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    let observed = worker.observe_next().await.unwrap();
    worker.acknowledge(observed.identity_generation).unwrap();
    coordinator
        .wait_for_workers(&bound, Duration::from_millis(50))
        .await
        .unwrap();
    coordinator.mark_transition_committed(&bound.transition_id).unwrap();
    coordinator.finalize_transition(&bound.transition_id).unwrap();

    let cleared = coordinator
        .begin_transition("main", None, None, 1, Duration::from_secs(10))
        .unwrap();
    let observed = worker.observe_next().await.unwrap();
    assert_eq!(observed.status, ShellIdentityStatus::Cleared);
    assert_eq!(observed.identity_generation, 2);
    worker.acknowledge(cleared.snapshot.identity_generation).unwrap();
}

#[test]
fn same_identity_does_not_increment_generation() {
    let coordinator = ShellIdentityCoordinator::default();
    let first = coordinator
        .begin_transition(
            "main",
            Some("token-a".into()),
            Some("actor-a".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    coordinator.mark_transition_committed(&first.transition_id).unwrap();
    coordinator.finalize_transition(&first.transition_id).unwrap();
    let second = coordinator
        .begin_transition(
            "main",
            Some("token-a".into()),
            Some("actor-a".into()),
            1,
            Duration::from_secs(10),
        )
        .unwrap();
    assert!(first.changed);
    assert!(!second.changed);
    assert_eq!(first.snapshot, second.snapshot);
}
~~~

~~~rust
#[test]
fn public_generation_limit_is_a_hard_error() {
    let coordinator =
        ShellIdentityCoordinator::with_generation_for_test(MAX_PUBLIC_IDENTITY_GENERATION);
    let error = coordinator
        .begin_transition(
            "main",
            Some("token-a".into()),
            Some("actor-a".into()),
            MAX_PUBLIC_IDENTITY_GENERATION,
            Duration::from_secs(10),
        )
        .unwrap_err();
    assert_eq!(error.reason_code(), "identity_generation_overflow");
}

#[test]
fn snapshot_serialization_contains_no_token_material() {
    let coordinator = ShellIdentityCoordinator::default();
    coordinator
        .begin_transition(
            "main",
            Some("secret-token-a".into()),
            Some("actor-a".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    let serialized = serde_json::to_string(&coordinator.snapshot().unwrap()).unwrap();
    assert!(!serialized.contains("secret-token-a"));
    assert!(!serialized.contains("token"));
}

#[test]
fn generation_is_never_reused_after_process_restart_or_crash_gap() {
    let store = DurableGenerationStoreHarness::empty();
    let first = ShellIdentityCoordinator::with_generation_store(store.clone()).unwrap();
    let a = first.begin_test_bind("actor-a", "token-a").unwrap();
    assert_eq!(a.snapshot.identity_generation, 1);
    drop(first); // crash before mark/finalize; reservation is still durable
    let restarted = ShellIdentityCoordinator::with_generation_store(store).unwrap();
    let b = restarted.begin_test_bind("actor-b", "token-b").unwrap();
    assert!(b.snapshot.identity_generation > a.snapshot.identity_generation);
}

#[test]
fn corrupt_or_unwritable_generation_store_fails_closed() {
    assert_reason(
        ShellIdentityCoordinator::with_generation_store(corrupt_store()).unwrap_err(),
        "identity_generation_store_failed"
    );
    assert_reason(
        ShellIdentityCoordinator::with_generation_store(unwritable_store()).unwrap_err(),
        "identity_generation_store_failed"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_worker_does_not_block_acknowledgement() {
    let coordinator = ShellIdentityCoordinator::default();
    let worker = coordinator.register_worker(IdentityWorkerKind::Sse).unwrap();
    let change = coordinator
        .begin_transition(
            "main",
            Some("token-a".into()),
            Some("actor-a".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    drop(worker);
    let barrier = coordinator
        .wait_for_workers(&change, Duration::from_millis(50))
        .await
        .unwrap();
    assert_eq!(barrier.registered_workers, 1);
    assert_eq!(barrier.acknowledged_workers, 0);
    assert_eq!(barrier.dropped_workers, 1);
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_notification_lifecycle_is_a_hard_barrier_failure() {
    let coordinator = ShellIdentityCoordinator::default();
    let worker = coordinator
        .register_worker(IdentityWorkerKind::NotificationLifecycle)
        .unwrap();
    let change = coordinator
        .begin_transition("main", None, None, 0, Duration::from_secs(10))
        .unwrap();
    drop(worker);
    let error = coordinator
        .wait_for_workers(&change, Duration::from_millis(50))
        .await
        .unwrap_err();
    assert_eq!(error.reason_code(), "identity_required_worker_dropped");
}

#[tokio::test(flavor = "current_thread")]
async fn missing_worker_ack_times_out_with_a_stable_reason() {
    let coordinator = ShellIdentityCoordinator::default();
    let _worker = coordinator.register_worker(IdentityWorkerKind::Sse).unwrap();
    let change = coordinator
        .begin_transition(
            "main",
            Some("token-a".into()),
            Some("actor-a".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    let error = coordinator
        .wait_for_workers(&change, Duration::from_millis(1))
        .await
        .unwrap_err();
    assert_eq!(error.reason_code(), "identity_worker_ack_timeout");
}

#[tokio::test(flavor = "current_thread")]
async fn clear_lease_rejects_concurrent_bind_until_finalize() {
    let harness = IdentityCommandHarness::bound("actor-a", "token-a");
    let clear = harness
        .begin(None, None, harness.current_generation())
        .await
        .unwrap();
    let error = harness
        .begin(
            Some("token-b".into()),
            Some("actor-b".into()),
            clear.snapshot.identity_generation,
        )
        .await
        .unwrap_err();
    assert_eq!(error.reason_code(), "identity_transition_in_progress");
    harness.mark_committed(&clear.transition_id).unwrap();
    let still_blocked = harness
        .begin(
            Some("token-b".into()),
            Some("actor-b".into()),
            clear.snapshot.identity_generation,
        )
        .await
        .unwrap_err();
    assert_eq!(still_blocked.reason_code(), "identity_transition_in_progress");
    harness.finalize(&clear.transition_id).unwrap();
    let bound_b = harness
        .begin(
            Some("token-b".into()),
            Some("actor-b".into()),
            clear.snapshot.identity_generation,
        )
        .await
        .unwrap();
    assert_eq!(bound_b.snapshot.actor_id.as_deref(), Some("actor-b"));
}

#[test]
fn clear_recovery_from_staged_bind_never_restores_an_older_generation() {
    let coordinator = ShellIdentityCoordinator::default();
    let bind = coordinator
        .begin_transition(
            "main",
            Some("token-b".into()),
            Some("actor-b".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    let recovery = coordinator
        .begin_clear_recovery(Some(&bind.transition_id))
        .unwrap();
    assert_eq!(recovery.snapshot.status, ShellIdentityStatus::Cleared);
    assert!(recovery.snapshot.identity_generation > bind.snapshot.identity_generation);
    assert_eq!(coordinator.read().unwrap().phase, ShellIdentityPhase::Recovering);
    coordinator
        .finalize_clear_recovery(&recovery.transition_id)
        .unwrap();
    assert_eq!(coordinator.read().unwrap().phase, ShellIdentityPhase::Stable);
}

#[test]
fn failed_worker_barrier_returns_a_clear_recovery_handle() {
    let coordinator = ShellIdentityCoordinator::bound_for_test("actor-a", "token-a");
    let clear = coordinator
        .begin_transition("main", None, None, 1, Duration::from_secs(10))
        .unwrap();
    let outcome = coordinator
        .fail_closed_transition(&clear.transition_id, "system_notification_clear_failed")
        .unwrap();
    assert!(matches!(outcome, ShellIdentityBeginOutcome::RecoveryRequired { .. }));
    let read = coordinator.read().unwrap();
    assert_eq!(read.snapshot.status, ShellIdentityStatus::Cleared);
    assert_eq!(read.phase, ShellIdentityPhase::Recovering);
    assert!(!coordinator.allows_private_side_effect(read.snapshot.identity_generation));
}

#[test]
fn expired_staged_bind_becomes_degraded_clear_not_stable_b() {
    let clock = TestClock::default();
    let coordinator = ShellIdentityCoordinator::with_clock(clock.clone());
    let bind = coordinator
        .begin_transition(
            "main",
            Some("token-b".into()),
            Some("actor-b".into()),
            0,
            Duration::from_secs(10),
        )
        .unwrap();
    clock.advance(Duration::from_secs(11));
    let error = coordinator.mark_transition_committed(&bind.transition_id).unwrap_err();
    assert_eq!(error.reason_code(), "identity_transition_lease_expired");
    let read = coordinator.read().unwrap();
    assert_eq!(read.snapshot.status, ShellIdentityStatus::Cleared);
    assert_eq!(read.phase, ShellIdentityPhase::Degraded);
    assert!(!coordinator.allows_private_side_effect(read.snapshot.identity_generation));
}

#[tokio::test(flavor = "current_thread")]
async fn degraded_identity_requires_successful_clear_recovery_before_bind() {
    let harness = IdentityCommandHarness::degraded_clear(2);
    let error = harness.begin_bind("actor-b", "token-b").await.unwrap_err();
    assert_eq!(error.reason_code(), "identity_recovery_failed");
    let recovery = harness.begin_recover_clear().await.unwrap();
    assert_eq!(recovery.phase, ShellIdentityPhase::Recovering);
    let recovered = harness.finalize_recover_clear(&recovery.transition_id).await.unwrap();
    assert_eq!(recovered.phase, ShellIdentityPhase::Stable);
    assert_eq!(recovered.snapshot.status, ShellIdentityStatus::Cleared);
    harness.begin_bind("actor-b", "token-b").await.unwrap();
}
~~~

For poisoned mutex coverage, `poison_state_for_test()` deliberately panics while holding the state lock under `catch_unwind`; `snapshot()` must then return `identity_state_poisoned` rather than `None` or a default snapshot.

- [ ] **Step 2: Run coordinator tests and record RED**

~~~bash
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml identity::
~~~

Expected: module-not-found/undefined-contract RED.

- [ ] **Step 3: Implement retained generation and worker acknowledgement**

Use:

~~~rust
struct IdentityState {
    committed_token: Option<String>,
    committed_snapshot: ShellIdentitySnapshot,
    next_generation: u64,
    next_worker_id: u64,
    workers: HashMap<u64, IdentityWorkerState>,
    active_transition: Option<ActiveIdentityTransition>,
    private_side_effects_blocked_reason: Option<String>,
}

struct ActiveIdentityTransition {
    transition_id: String,
    owner_window: String,
    phase: ActiveIdentityTransitionPhase,
    target_token: Option<String>,
    target_snapshot: ShellIdentitySnapshot,
    registered_worker_ids: HashSet<u64>,
    expires_at: Instant,
}

struct IdentityInner {
    state: Mutex<IdentityState>,
    generation_store: DurableIdentityGenerationStore,
    generation_tx: watch::Sender<u64>,
    acknowledgement_changed: Notify,
}

#[derive(Clone)]
pub struct ShellIdentityCoordinator {
    inner: Arc<IdentityInner>,
}
~~~

`begin_transition` is main-window-only and receives `expected_generation`. It first expires/logs a stale lease past its ten-second monotonic `Instant` deadline, rejects any live lease with `identity_transition_in_progress`, rejects a stale expected generation, then creates a cryptographically random UUID transition id. It requires token and actor together, checks `checked_add(1)` and the public maximum `9_007_199_254_740_991`, atomically writes/fsyncs the new counter to the app's identity-generation file, then stages the target token/public snapshot, captures registered worker ids, installs the lease, marks private side effects unstable, and broadcasts `IdentitySignal::Preparing(target_generation)`. The generation file is loaded before the coordinator gate becomes ready, contains no credential, and never falls back to zero on parse/read/write failure. A crash after reservation may skip a value but can never reuse it. A same-identity call still acquires a lease for WebView synchronization but has `changed=false`, captures no worker barrier, and does not increment or broadcast a generation. Command responses expose `lease_remaining_ms`, computed from the same monotonic deadline after the worker barrier; JavaScript anchors that duration to `performance.now()` on receipt and never compares Rust `Instant` with wall-clock epoch time.

`DurableIdentityGenerationStore` owns `<app_config_dir>/identity-generation-v1.json` with exact `{ "version": 1, "last_reserved_generation": <safe integer> }` schema. Under Tauri single-instance ownership, reserve holds the coordinator mutex, creates same-directory mode-0600/no-follow `identity-generation-v1.json.tmp.<uuid>` with `create_new`, flushes and `fsync`s it, atomically renames it over the target, and `fsync`s the parent directory before returning; only then may state stage/publish the generation. Startup trusts only the canonical target, safely removes/ignores stale same-prefix regular temps from crash-before-rename, and refuses temp/target symlink, non-regular, oversized, extra-field, or corrupt content. It never treats a temp generation as reserved. Read, write, rename, fsync, and overflow map to `identity_generation_store_failed` except the public numeric bound, which remains `identity_generation_overflow`; diagnostics include operation/path class but no file content. Tests cover stale-temp restart and fixed-temp symlink attacks. Task 7's fixed QA bundle/profile gets a distinct app-config directory and counter file, preserved across its test restart and never shared with production.

`PrivateDesktopIdentityStore` separately owns `<app_config_dir>/desktop-identity-private-v2.json`, mode 0600, with exact envelope `{version:1, revision:u64, record:DesktopIdentityRecordV2}`. Revision is checked-incremented and capped at JavaScript `Number.MAX_SAFE_INTEGER`; overflow is `local_identity_revision_overflow`. It is the native authority for token, bootstrap cancel capability, actor/device ids, and record state. `compare_and_swap(expected_revision, record)` validates the full state-dependent Rust schema, writes a random `desktop-identity-private-v2.json.tmp.<uuid>` with `create_new`/no-follow, flushes+fsyncs, renames, fsyncs the directory, and only then returns a redacted `{revision,state}` ack. Startup trusts only the canonical regular file; stale regular temp files are safely removed/ignored, while temp/target symlinks or non-regular files fail closed. A crash before rename leaves the earlier canonical revision; a returned ack guarantees the renamed revision survived process restart under the filesystem contract.

Add main-only private commands `get_private_desktop_identity` and `compare_and_swap_private_desktop_identity`; the former returns the credential record only to `main`, and absence returns explicit `uninitialized`. Add Pet-only `get_pet_private_identity(request)` with an explicit matrix: stable boot/recreation may omit transition id only when native phase is Stable and the private record is exact `bound`; transition `prepare` requires exact id/generation and allows native Preparing **or Committing** so a Pet restarted during commit can replay prepare without starting work; transition `commit` requires exact Committing; Recovering/Degraded/clear/pending/wrong id returns no credential. Rust checks caller label `pet` and snapshot actor before returning actor/token privately. No private record appears in public snapshot/event, error, debug formatting, report, or log. Tests cover restart-during-commit prepare replay, stable-B Pet recreation, and commit-ack→Pet crash→Rust finalize→stable private boot. The plain non-Tauri browser adapter may use strict localStorage v2 but is explicitly outside native force-kill certification.

Add Rust tests for CAS conflict, schema rejection, mode/path guards, write/fsync/rename failures, stale random temp after crash-before-rename, acknowledged-write restart recovery, main/Pet/wrong-surface access, Pet prepare/commit phase checks, and redacted serialization/logging. Task 7 adds packaged `_exit` failpoints after pending-activation persist ack and after server activation commit with response withheld; restart must recover the exact attempt and cancel/revoke it.

Workers receiving `Preparing` cancel/drop the committed generation and clean their old private state, acknowledge the target generation, then wait; the staged target token is not available to request builders and no target SSE/notification starts. `wait_for_workers` creates `notified()` before inspecting the map and returns `IdentityWorkerBarrier { registered_workers, acknowledged_workers, dropped_workers }`. A timeout reports the missing count only in the error. A worker may report a stable non-secret failure (for example `system_notification_clear_failed`); the barrier returns that reason immediately instead of disguising it as a timeout. Registration records `IdentityWorkerKind`: dropping an SSE registration is quiescent because the handle owns/drops its response and counts in `dropped_workers`; dropping the mandatory `NotificationLifecycle` registration is `identity_required_worker_dropped` and fails the barrier. Both paths notify waiters.

Worker registration is race-safe: every mandatory default worker is registered/spawned before the identity startup gate becomes ready. A later worker registering during Preparing/Committing/Recovering is parked on that exact transition generation and cannot read the committed/staged token or produce effects until finalization; mandatory registration failure blocks readiness. Tests race registration with begin and prove it either belongs to the captured barrier or remains parked until Committed—never an unbarriered active worker.

`mark_transition_committed` requires the exact transition id/Preparing phase, atomically installs the staged token/snapshot as committed, advances the lease to `Committing`, and keeps all Rust private side effects blocked; it returns `ShellIdentityRead(phase=committing)`. Only `finalize_transition`, after Pet commit/ready ack, clears the lease/block and broadcasts `IdentitySignal::Committed`, allowing workers to read the target token and connect.

Clear recovery is also leased. `begin_clear_recovery` works from Preparing, Committing, or Degraded, never rolls generation backward, drops all token material, allocates/stages a cleared snapshot, advances phase to `Recovering`, and keeps private effects blocked. JS must synchronize Pet through clear prepare+commit or prove Pet destruction, then `finalize_clear_recovery` reruns/validates the mandatory worker barrier and releases stable clear. A failed initial worker barrier returns typed `ShellIdentityBeginOutcome::RecoveryRequired` containing the clear recovery id/snapshot and original stable reason; it never returns a bare error that prevents Pet synchronization. If recovery cannot complete, state remains degraded/blocked.

Lease expiry invokes fail-closed clear and retains a recoverable/degraded block before returning `identity_transition_lease_expired`; it never releases a staged/committing bind as stable and a new bind cannot bypass recovery.

Add Tokio `rt` to the existing features for current-thread async tests.

- [ ] **Step 4: Write failing active worker tests**

~~~rust
#[tokio::test(flavor = "current_thread")]
async fn worker_waits_without_a_token_instead_of_opening_anonymous_sse() {
    let harness = SseWorkerHarness::without_identity();
    let worker = harness.spawn();
    sleep(Duration::from_millis(10)).await;
    assert_eq!(harness.open_attempts(), 0);
    assert_eq!(harness.last_status_reason(), Some("token_cleared"));
    worker.abort();
}

#[tokio::test(flavor = "current_thread")]
async fn active_response_is_dropped_before_change_is_acknowledged() {
    let harness = SseWorkerHarness::bound("actor-a", "token-a");
    let worker = harness.spawn();
    harness.wait_until_open().await;
    let change = harness
        .coordinator
        .begin_transition(
            "main",
            None,
            None,
            harness.current_generation(),
            Duration::from_secs(10),
        )
        .unwrap();
    harness
        .coordinator
        .wait_for_workers(&change, Duration::from_millis(50))
        .await
        .unwrap();
    assert!(harness.active_response_dropped());
    assert_eq!(harness.emitted_payload_count(), 0);
    worker.abort();
}

#[tokio::test(flavor = "current_thread")]
async fn revoked_stream_is_terminal_until_identity_generation_changes() {
    let harness = SseWorkerHarness::bound("actor-a", "token-a");
    harness.respond_forbidden("stream_auth_revoked");
    let worker = harness.spawn();
    harness.wait_for_terminal_status().await;
    harness.advance(Duration::from_secs(60)).await;
    assert_eq!(harness.open_attempts(), 1);
    harness.commit_new_identity("actor-b", "token-b").await;
    harness.wait_until_open().await;
    assert_eq!(harness.open_attempts(), 2);
    worker.abort();
}

#[test]
fn runtime_request_contains_exactly_one_token_header_pair() {
    let request = planned_runtime_request("token-a");
    assert_eq!(request.header_values(WORKHUB_CLIENT_TOKEN_HEADER), vec!["token-a"]);
    assert_eq!(request.header_values(LEGACY_CLIENT_TOKEN_HEADER), vec!["token-a"]);
}

#[tokio::test(flavor = "current_thread")]
async fn worker_clears_delivered_notifications_and_dedupe_before_ack() {
    let harness = SseWorkerHarness::bound("actor-a", "token-a");
    harness.seed_delivered_notification(1, "run-a");
    harness.seed_dedupe_key(1, "attention:run-a");
    let worker = harness.spawn();
    harness.wait_until_open().await;
    let change = harness.begin_clear_transition().unwrap();
    let barrier = harness
        .coordinator
        .wait_for_workers(&change, Duration::from_millis(50))
        .await
        .unwrap();
    assert_eq!(barrier.registered_workers, 2); // SSE + notification lifecycle
    assert_eq!(barrier.acknowledged_workers, 2);
    assert_eq!(harness.delivered_notification_count(), 0);
    assert!(!harness.has_dedupe_key(1, "attention:run-a"));
    assert!(harness.notification_cleanup_finished_before_ack());
    worker.abort();
}

#[tokio::test(flavor = "current_thread")]
async fn notification_cleanup_failure_refuses_worker_ack() {
    let harness = SseWorkerHarness::bound("actor-a", "token-a");
    harness.fail_notification_cleanup();
    let worker = harness.spawn();
    harness.wait_until_open().await;
    let change = harness.begin_clear_transition().unwrap();
    let error = harness
        .coordinator
        .wait_for_workers(&change, Duration::from_millis(50))
        .await
        .unwrap_err();
    assert_eq!(error.reason_code(), "system_notification_clear_failed");
    worker.abort();
}

#[tokio::test(flavor = "current_thread")]
async fn unsettled_old_notification_submission_refuses_worker_ack() {
    let harness = SseWorkerHarness::bound("actor-a", "token-a");
    harness.hold_notification_did_deliver("workhub:process-a:1:7");
    let worker = harness.spawn();
    harness.wait_until_open().await;
    let change = harness.begin_clear_transition().unwrap();
    let error = harness
        .coordinator
        .wait_for_workers(&change, Duration::from_millis(50))
        .await
        .unwrap_err();
    assert_eq!(error.reason_code(), "system_notification_delivery_unsettled");
    worker.abort();
}

#[test]
fn delayed_old_generation_notification_delivery_and_activation_are_rejected() {
    let harness = NotificationLifecycleHarness::at_generation(3);
    assert_eq!(harness.deliver(notification_plan(2, "run-a")), Stale);
    assert_eq!(harness.activate(notification_plan(2, "run-a")), Stale);
    assert_eq!(harness.deliver(notification_plan(3, "run-b")), Delivered);
}

#[test]
fn dedupe_reset_allows_same_key_in_new_generation() {
    let mut dedupe = NotificationDedupe::default();
    assert!(dedupe.claim(1, "attention:run-1"));
    assert!(!dedupe.claim(1, "attention:run-1"));
    dedupe.reset_for_generation(2);
    assert!(dedupe.claim(2, "attention:run-1"));
}

#[test]
fn failed_native_submission_does_not_consume_dedupe_key() {
    let harness = NotificationLifecycleHarness::at_generation(1);
    harness.fail_next_submission();
    assert_eq!(harness.deliver(notification_plan(1, "run-a")), SubmitFailed);
    assert_eq!(harness.deliver(notification_plan(1, "run-a")), Submitted);
}

#[test]
fn synchronous_did_deliver_reentry_cannot_deadlock_submission() {
    let harness = NotificationLifecycleHarness::at_generation(1);
    harness.callback_did_deliver_before_native_return();
    let submitted = harness.deliver(notification_plan(1, "run-a"));
    assert_eq!(submitted, Submitted);
    assert_eq!(harness.pending_submission_count(), 0);
    assert!(harness.has_committed_dedupe(1, "attention:run-a"));
}

#[test]
fn late_delivery_after_timeout_is_immediately_removed() {
    let harness = NotificationLifecycleHarness::at_generation(1);
    let id = harness.submit_without_receipt(notification_plan(1, "run-a"));
    harness.expire_receipt_and_enter_recovery(&id);
    harness.did_deliver(&id);
    assert_eq!(harness.native_remove_calls(), vec![id]);
    assert_eq!(harness.activation_registry_count(), 0);
}

#[test]
fn notification_identifier_is_unique_across_process_restart() {
    let first = NotificationLifecycleHarness::with_process_nonce("process-a", 3, 1);
    let second = NotificationLifecycleHarness::with_process_nonce("process-b", 3, 1);
    assert_ne!(first.next_identifier(), second.next_identifier());
}

#[test]
fn native_center_and_delegate_never_enter_send_sync_managed_state() {
    assert_send_sync::<ShellNotificationLifecycle>();
    assert!(notification_native_actor_is_main_thread_only());
}

#[test]
fn current_b_activation_calls_the_validated_sink_exactly_once() {
    let harness = NotificationLifecycleHarness::at_generation(3);
    let submitted = harness.deliver(notification_plan(3, "run-b"));
    harness.did_deliver(submitted.identifier());
    harness.activate_identifier(submitted.identifier());
    harness.activate_identifier(submitted.identifier());
    harness.activate_identifier("workhub:2:old-a");
    harness.activate_identifier("unknown");
    assert_eq!(harness.activation_sink_calls(), vec![window_control_for("run-b")]);
}
~~~

Run:

~~~bash
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml sse_worker::
~~~

Expected: RED because active pump does not observe token changes.

- [ ] **Step 5: Race every worker phase against identity change**

Register one identity worker per subscription. With no committed token, emit `closed/token_cleared` once and wait; do not open an anonymous 401 loop. On `Preparing`, cancel the current connect/pump/backoff, drop the response, acknowledge, and wait for `Committed`; never open the staged token. Use the same `race_identity_change` helper around connection, `pump_sse_response`, and backoff. Use `tokio::select! { biased; ... }` with identity first. Classify connect/pump `401`/`403` as terminal `stream_auth_revoked`: emit one visible identity diagnostic, make no retry/backoff request, and wait for generation change. Only transport/5xx failures use bounded reconnect. A regression revokes device/membership, holds generation constant, and proves request count remains one until a later identity transition.

Before every push emit and every system-notification reservation/activation, enter the coordinator through one synchronous atomic guard:

~~~rust
let reservation = identity.reserve_stable_private_side_effect(identity_generation)?;
emit_or_dispatch_without_identity_lock()?;
reservation.finish()?;
~~~

`reserve_stable_private_side_effect` increments an outstanding count under the coordinator mutex only when phase/generation are stable and returns an RAII reservation. The reservation owns no mutex guard. `begin_transition` atomically changes phase to Preparing under that mutex, then releases it and waits for all already-reserved effects to settle before beginning the worker barrier. No notification/native/window callback is invoked while the identity mutex is held; this avoids synchronous AppKit delegate re-entry deadlocks while preserving the check/use boundary. Dropping an unfinished reservation is a stable worker failure, not a silent success. Add snake_case `identity_generation` to the existing snake_case `ShellPushEventPayload`/`ShellSseStatusPayload` contracts; add camelCase `identityGeneration` to the already-camelCase `ShellSystemNotificationPlan` and activation telemetry contract. TypeScript parsers require the matching form and tests reject the wrong casing. Reservation rejects any active transition, degraded state, lock poison, or generation mismatch.

Lock order is fixed: the coordinator never calls notification code while holding identity state, and notification code never calls native APIs or identity code while holding its registry lock. Add deterministic tests that race delivery with transition and synchronously re-enter `didDeliverNotification`; prove either receipt-before-transition-then-clear or stale rejection, with no deadlock and no post-ack record.

Do not use `tauri_plugin_notification::Notification::show` for identity-sensitive notifications. The locally resolved desktop plugin discards identifiers/actions and spawns delivery, so it cannot provide a receipt, selective clear, or gated click. Keep the plugin only for permission state/request. `notification_lifecycle.rs` owns the macOS `NSUserNotificationCenter` through a main-thread-only native actor: one process-lifetime delegate plus center are created, called, and dropped only on Tauri's main thread. `ShellNotificationLifecycle` managed state remains `Send + Sync` by containing only a request channel, receipt notification, and a mutex-protected pure-Rust registry; it never stores `Retained<NSUserNotificationCenter>` or the delegate in cross-thread managed state.

Identifiers are opaque and process-unique: `workhub:<process_nonce>:<generation>:<sequence>`, where `process_nonce` is a cryptographically random UUID generated at startup and sequence is checked `u64`; overflow is `system_notification_sequence_overflow`. The id contains no actor, route, title, body, or token, and the same generation/sequence across two app launches must produce different ids. Add direct `uuid = { version = "1.23.2", features = ["v4"] }` plus lockfile change; use it for both transition ids and notification process nonce instead of implicit/transitive randomness.

Submission is explicitly re-entrancy-safe: reserve the stable side effect; pre-register `pending_submission` and activation plan under the lifecycle registry lock; release the lock; dispatch `deliverNotification` to the main-thread actor; allow `didDeliverNotification` to settle the pending receipt even if it fires before `deliverNotification` returns; then reconcile the native return and receipt without holding either identity or registry mutex. Commit the dedupe key only after successful native submission/receipt. On native error, remove the pending activation and leave dedupe unconsumed. Cleanup likewise snapshots ids under lock, releases it, performs main-thread inspection/removal, and reconciles afterward.

Register notification lifecycle as its own identity worker, separate from every SSE subscription. When it observes a transition, the coordinator has already marked the generation unstable, so no new submit/activate can pass. The worker waits for every prior-generation `pending_submission` to receive `didDeliverNotification` (bounded by the worker barrier), then iterates delivered notifications and removes only identifiers with the `workhub:` prefix, clears the activation registry and old-generation dedupe, verifies pending count zero, and acknowledges. A pending receipt timeout reports `system_notification_delivery_unsettled`; inspection/removal/registry failure reports `system_notification_clear_failed`; neither acknowledges.

A late `didDeliverNotification` for a timed-out, recovering, degraded, or old-generation id is quarantined: the delegate immediately schedules removal of that exact id on the main-thread actor, records `stream_identity_changed`, and never restores activation/dedupe state. Tests cover callback-before-return, late callback-after-timeout, lifecycle-worker drop, and a delivery/transition race with outstanding-reservation drain.

At the production packaged `com.mycyg.workhub` startup, before SSE workers start, use an atomically written app-config marker `notification-lifecycle-v1-migrated`. When absent, perform one broad `removeAllDeliveredNotifications()` legacy migration because notifications created by the old plugin have random untagged identifiers, then persist the marker; marker/clear failure blocks worker startup. On every later startup, selectively clear only `workhub:` identifiers before binding identity. Never broad-clear in `tauri dev`: the old plugin identifies as `com.apple.Terminal`, so that could remove unrelated Terminal notifications. Task 7's packaged QA build uses its own non-production bundle id, notification identity, config root, and migration marker, so its first-run broad clear is confined to the isolated QA app. After migration, transitions use selective removal only.

Use the locally verified target dependencies exactly:

~~~toml
uuid = { version = "1.23.2", features = ["v4"] }
objc2 = "0.6.4"
objc2-foundation = { version = "0.3.2", default-features = false, features = ["std", "NSArray", "NSObject", "NSString", "NSUserNotification"] }
~~~

Implement the persistent delegate with `objc2::define_class!`; because `setDelegate` is unretained, the main-thread native actor retains `WorkHubNotificationDelegate` until app exit. Limit `#[allow(deprecated)]` to this backend module. A non-macOS trait implementation preserves compile/test coverage and generation/dedupe semantics but does not claim native cleanup certification. Delivery callback logs `submitted` and `did_deliver` separately; only Notification Center inspection may be reported as OS-visible. Activation atomically **takes/removes** the opaque id from the registry before releasing its lock, then reserves the exact stable generation and invokes the injected synchronous `NotificationActivationSink`; two native callbacks for the same valid id therefore execute once. `main.rs` implements the sink with existing `execute_window_control`, so route/show/focus behavior has one owner. The TypeScript `system-notification-activated` event is observation/telemetry-only and can never navigate. Stale/transitioning/unknown activation removes the record, does nothing else, and records `stream_identity_changed`.

Add and lock `system-notification-activated` in `events.rs` for the generation-tagged TypeScript observation path. Update both notification/client SSOT documents and root `AGENTS.md`: the ordinary-user release is LAN-first macOS, identity is a staged Rust coordinator owned by the main WebView transition, and identity-sensitive notifications are owned by `ShellNotificationLifecycle`, not `tauri-plugin-notification`; the plugin remains permission-only. Preserve the user's fail-fast/root-cause/observability/mainline rules in that file. Historical P1-11 is not automatically closed by this batch—its status changes only with the required exact-route physical evidence.

Permission denial or native submission failure emits a structured stable warning and does not consume the OS dedupe key; the generation-tagged in-app event may still be emitted after its own stable-generation check. It must not be logged as delivered. The native release gate treats missing permission as `notification_permission_missing` and fails because this batch requires OS-boundary evidence.

Builder/setup order is contractual: before any WebView data load, validate/clean temp state for both the durable generation store and `PrivateDesktopIdentityStore`, verify permissions/schema, manage both stores plus the coordinator/startup gate, construct the main-thread notification actor/delegate, complete startup notification migration/selective clear, register and spawn the mandatory notification lifecycle plus every default SSE worker, verify they are parked/ready, and only then mark the identity gate ready. Dynamically added workers obey the transition-aware registration rule above. Coordinator and private-store commands both check readiness; corrupt/unwritable private state exits with its stable reason before main/Pet can load. Builder-order tests prove neither command family nor WebView startup becomes available when either store/worker is unready.

Delete the token-tail log and use:

~~~rust
eprintln!(
    "workhub_shell event=identity_changed generation={} status={:?} actor_id={}",
    ack.snapshot.identity_generation,
    ack.snapshot.status,
    ack.snapshot.actor_id.as_deref().unwrap_or("none")
);
~~~

- [ ] **Step 6: Replace the fire-and-forget command with a transition lease**

~~~rust
#[tauri::command]
async fn begin_client_identity_change(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ShellIdentityCoordinator>,
    token: Option<String>,
    actor_id: Option<String>,
    expected_generation: u64,
) -> Result<ShellIdentityBeginOutcome, String> {
    if window.label() != "main" {
        return Err("identity_transition_wrong_surface".to_string());
    }
    let coordinator = state.inner().clone();
    let change = coordinator
        .begin_transition(
            "main",
            token,
            actor_id,
            expected_generation,
            Duration::from_secs(10),
        )
        .map_err(|error| error.reason_code().to_string())?;
    let barrier = match coordinator
        .wait_for_workers(&change, Duration::from_secs(2))
        .await
    {
        Ok(barrier) => barrier,
        Err(error) => {
            let recovery = coordinator
                .begin_fail_closed_recovery(&change.transition_id, error.reason_code())
                .map_err(|fail_closed| fail_closed.reason_code().to_string())?;
            return Ok(ShellIdentityBeginOutcome::RecoveryRequired {
                recovery,
                reason_code: error.reason_code().to_string(),
            });
        }
    };
    Ok(ShellIdentityBeginOutcome::Prepared {
      transition: ShellIdentityTransitionAck {
        transition_id: change.transition_id,
        snapshot: change.snapshot,
        changed: change.changed,
        registered_workers: barrier.registered_workers,
        acknowledged_workers: barrier.acknowledged_workers,
        dropped_workers: barrier.dropped_workers,
        lease_remaining_ms: coordinator
          .lease_remaining_ms(&change.transition_id)
          .map_err(|error| error.reason_code().to_string())?,
      }
    })
}

#[tauri::command]
fn mark_client_identity_committed(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ShellIdentityCoordinator>,
    transition_id: String,
) -> Result<ShellIdentityRead, String> {
    if window.label() != "main" {
        return Err("identity_transition_wrong_surface".to_string());
    }
    state
        .mark_transition_committed(&transition_id)
        .map_err(|error| error.reason_code().to_string())
}
~~~

Add main-only `finalize_client_identity_change`, `begin_client_identity_clear_recovery`, and `finalize_client_identity_clear_recovery`, plus main-only `get_client_identity` and read-only `get_public_client_identity`. Main get returns `ShellIdentityRead` including the non-secret active transition descriptor and remaining lease so a reloaded main WebView can resume/clear Preparing, Committing, or Recovering. Public get returns `ShellIdentityPublicRead` without transition id/lease and is the only read Pet may call. Pet startup performs no API/restore work unless phase is `stable`, while main refuses ordinary begin from preparing/committing/recovering/degraded. `mark_client_identity_committed` does not release the lease or wake private Rust workers. Finalize requires the exact Committing transition id after Pet commit ack. Clear recovery accepts an optional failed transition id (or Degraded state), returns a leased cleared snapshot, and finalizes stable only after Pet clear commit ack or confirmed `destroy_pet_identity_surface`; mandatory notification cleanup must be green. A failed initial worker barrier returns typed `RecoveryRequired`, so JS always receives the generation/id required to clear Pet and canonical storage. No bare worker error may strand an unsynchronized generation.

Also add main-only `restart_pet_identity_surface(transition_id)` and `destroy_pet_identity_surface(transition_id)`. Both require the exact active Preparing/Committing/Recovering transition id and main owner; stale/missing/stable-phase ids fail `identity_transition_in_progress`/`identity_transition_wrong_surface` without touching the window. Restart closes the current Pet WebView, verifies the handle is gone, recreates it through the existing `create_pet_window_with_surface_flag`/startup path, and returns only after the new WebView exists; while identity is non-stable, its boot path waits and cannot render committed A restore state. Destroy closes and verifies absence without recreation. Unit seams assert wrong-window and stale-id rejection, main reload recovery for every non-stable phase, public-get descriptor redaction, close-before-create ordering, and hard failure when destruction cannot be confirmed. Manage the coordinator/store, register exactly nine coordinator/surface commands plus three private-store commands (12 total) with an invoke-handler list/count contract test, and remove `ShellClientToken`/`set_client_token`.

- [ ] **Step 7: Run native verification and commit**

~~~bash
cargo fmt --manifest-path client-tauri/src-tauri/Cargo.toml -- --check
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml
cargo build --manifest-path client-tauri/src-tauri/Cargo.toml
cargo build --release --manifest-path client-tauri/src-tauri/Cargo.toml
rg -n 'client token received|client token.*…|ShellClientToken|set_client_token' \
  client-tauri/src-tauri/src
git diff --check
~~~

Expected: format/test/build exit `0`; unsafe/old-authority search exits `1`.

~~~bash
git add client-tauri/src-tauri/Cargo.toml \
  client-tauri/src-tauri/Cargo.lock \
  client-tauri/src-tauri/src/identity.rs \
  client-tauri/src-tauri/src/identity_store.rs \
  client-tauri/src-tauri/src/lib.rs \
  client-tauri/src-tauri/src/main.rs \
  client-tauri/src-tauri/src/notification_lifecycle.rs \
  client-tauri/src-tauri/src/events.rs \
  client-tauri/src-tauri/src/sse.rs \
  client-tauri/src-tauri/src/sse_worker.rs \
  client-tauri/src-tauri/src/notify.rs \
  AGENTS.md \
  docs/workhub/04-modules/tasks-reminders-notifications.md \
  docs/workhub/05-clients/desktop-pet-tauri.md
git commit -m "fix(desktop): acknowledge identity stream cancellation"
~~~

---

### Task 3: Make bootstrap crash-safe and reauthorize already-open API streams

**Files:**
- Modify: `apps/api/src/middleware/auth.ts:486-520`
- Modify: `apps/api/src/routes/auth.ts:158-267`
- Create: `apps/api/src/services/desktop-bootstrap.ts`
- Create: `apps/api/src/middleware/desktop-bootstrap-throttle.ts`
- Create: `apps/api/src/desktop-bootstrap-throttle.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/middleware/csrf.ts`
- Modify: `apps/api/src/csrf.test.ts`
- Modify: `apps/api/src/route-auth-posture.test.ts`
- Modify: `apps/api/src/routes/push.ts:113-191`
- Modify: `apps/api/src/sse/stream.ts:12-125`
- Modify: `apps/api/src/sse/topic-access.ts`
- Create: `apps/api/src/sse/strict-writer.ts`
- Create: `apps/api/src/sse/strict-writer.test.ts`
- Modify: `apps/api/src/push.test.ts`
- Create: `apps/api/src/stream-authorization-pg.test.ts`
- Modify: `apps/api/src/auth.test.ts`
- Modify: `apps/api/src/http-error-codes.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/push.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/db/src/repositories/memberships.ts`
- Modify: `packages/db/src/schema/core.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/memberships-repository.test.ts`
- Create: `packages/db/src/repositories/device-bootstrap-attempts.ts`
- Create: `packages/db/src/repositories/stream-authorization.ts`
- Create: `packages/db/src/device-bootstrap-attempts.test.ts`
- Create: `packages/db/src/stream-authorization.test.ts`
- Modify: `packages/db/src/schema.test.ts`
- Create: `packages/db/migrations/0046_repair_default_workspace_memberships.sql`
- Create: `packages/db/migrations/0047_client_device_bootstrap_attempts.sql`
- Create: `packages/db/migrations/0048_stream_authorization_write_fence.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `scripts/qa/desktop-identity-db-pg.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing auth dependencies and canonical stream topic selector types.
- Produces: non-expanding identity membership provisioning, unauthenticated expiring pending devices with idempotent activate/cancel, and a required transaction-locked `authorizeAndWrite` boundary that makes revocation commit serialize against every SSE frame.

- [ ] **Step 1: Write failing revocation tests**

~~~ts
test("an already-open token stream closes before a post-revoke event is written", async () => {
  const harness = revokedDeviceStreamHarness();
  const response = await harness.open();
  const reader = response.body!.getReader();
  assert.match(harness.decode(await reader.read()), /event: connected/u);
  harness.revokePresentedDevice();
  await harness.publishPrivate("must-not-cross");
  const remaining = await harness.readUntilDone(reader, 250);
  assert.doesNotMatch(remaining.text, /must-not-cross/u);
  assert.equal(remaining.done, true);
  assert.equal(harness.presence.closeCalls, 1);
});

test("reauthorization repository failure closes fail-closed", async () => {
  const harness = revokedDeviceStreamHarness();
  const response = await harness.open();
  const reader = response.body!.getReader();
  await reader.read();
  harness.throwOnNextDeviceLookup(new Error("postgres unavailable"));
  await harness.publishPrivate("must-not-cross");
  const remaining = await harness.readUntilDone(reader, 250);
  assert.doesNotMatch(remaining.text, /must-not-cross/u);
  assert.equal(remaining.done, true);
});
~~~

~~~ts
test("an already-open session stream closes after logout revokes that session", async () => {
  const harness = revokedSessionStreamHarness();
  const response = await harness.open();
  const reader = response.body!.getReader();
  await reader.read();
  harness.revokePresentedSession();
  await harness.publishPrivate("session-secret");
  const remaining = await harness.readUntilDone(reader, 250);
  assert.doesNotMatch(remaining.text, /session-secret/u);
  assert.equal(remaining.done, true);
  assert.equal(harness.bus.unsubscribeCalls, 1);
  assert.equal(harness.presence.closeCalls, 1);
  assert.equal(harness.deviceTouchCalls, 0);
  assert.equal(harness.sessionTouchCallsAfterOpen, 0);
});
~~~

~~~ts
test("removing active workspace membership closes an already-open stream", async () => {
  const harness = revokedMembershipStreamHarness();
  const response = await harness.open();
  const reader = response.body!.getReader();
  await reader.read();
  harness.softDeleteMembership();
  await harness.publishPrivate("membership-secret");
  const remaining = await harness.readUntilDone(reader, 250);
  assert.doesNotMatch(remaining.text, /membership-secret/u);
  assert.equal(remaining.done, true);
});

test("stream opening fails closed when membership capability is unavailable", async () => {
  const response = await streamRouteHarness({ memberships: undefined }).open();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "stream_membership_unavailable");
});

test("stream opening requires an active default membership", async () => {
  const h = streamRouteHarness();
  h.softDeleteMembership();
  const response = await h.open();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "workspace_membership_required");
});

test("nickname identify creates membership before its first stream", async () => {
  const h = nicknameIdentityStreamHarness();
  const identify = await h.identify("Alice");
  assert.equal(identify.status, 201);
  const stream = await h.openMeStreamWithCookie(identify);
  assert.equal(stream.status, 200);
  assert.match(await h.firstFrame(stream), /event: connected/u);
  assert.equal(h.activeDefaultMembershipCountForIdentifiedUser(), 1);
});

test("desktop bootstrap creates membership but pending token cannot authenticate before activation", async () => {
  const h = nicknameIdentityStreamHarness();
  const attempt = bootstrapAttempt();
  const bootstrap = await h.bootstrapDesktop("Alice", attempt);
  assert.equal(bootstrap.status, 202);
  const denied = await h.openMeStreamWithBootstrapToken(bootstrap);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "invalid_client_token");
  const activation = await h.activateBootstrap(bootstrap, attempt);
  assert.equal(activation.status, 200);
  const stream = await h.openMeStreamWithBootstrapToken(bootstrap);
  assert.equal(stream.status, 200);
  assert.match(await h.firstFrame(stream), /event: connected/u);
  assert.equal(h.activeDefaultMembershipCountForBootstrappedUser(), 1);
});

test("pending token is cancellable without possessing the response token and never authenticates", async () => {
  const h = nicknameIdentityStreamHarness();
  const attempt = bootstrapAttempt();
  const bootstrap = await h.bootstrapDesktop("Alice", attempt);
  const cancelled = await h.cancelBootstrap(attempt);
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).state, "cancelled");
  assert.equal((await h.openMeStreamWithBootstrapToken(bootstrap)).status, 403);
  assert.equal(h.activeDeviceCount(), 0);
});

test("activation is exact-attempt idempotent and a different secret cannot activate or cancel", async () => {
  const h = nicknameIdentityStreamHarness();
  const attempt = bootstrapAttempt();
  const bootstrap = await h.bootstrapDesktop("Alice", attempt);
  assert.equal((await h.activateBootstrap(bootstrap, wrongBootstrapSecret())).status, 403);
  assert.equal((await h.cancelBootstrap(wrongBootstrapSecret())).status, 403);
  assert.equal((await h.activateBootstrap(bootstrap, attempt)).status, 200);
  assert.equal((await h.activateBootstrap(bootstrap, attempt)).status, 200);
  assert.equal(h.activeDeviceCount(), 1);
});

test("cancel after activation response loss revokes the linked active device", async () => {
  const h = nicknameIdentityStreamHarness();
  const attempt = bootstrapAttempt();
  const bootstrap = await h.bootstrapDesktop("Alice", attempt);
  await h.activateBootstrap(bootstrap, attempt);
  assert.equal(h.activeDeviceCount(), 1);
  assert.equal((await h.cancelBootstrap(attempt)).status, 200);
  assert.equal(h.activeDeviceCount(), 0);
  assert.equal((await h.openMeStreamWithBootstrapToken(bootstrap)).status, 403);
});

test("expired pending token cannot activate and is cleaned without becoming active", async () => {
  const h = nicknameIdentityStreamHarness({ pendingDeviceTtlMs: 5 });
  const attempt = bootstrapAttempt();
  const bootstrap = await h.bootstrapDesktop("Alice", attempt);
  h.advance(6);
  const activation = await h.activateBootstrap(bootstrap, attempt);
  assert.equal(activation.status, 410);
  assert.equal((await activation.json()).error.code, "bootstrap_pending_device_expired");
  assert.equal(h.activeDeviceCount(), 0);
});

test("an existing cross-workspace user gains no configured-default membership", async () => {
  const h = nicknameIdentityStreamHarness();
  h.seedExistingUserWithActiveMembership("Alice", "workspace-other", { isDefault: false });
  const identify = await h.identify("Alice");
  assert.equal(identify.status, 200);
  assert.equal(h.membershipCount("Alice", "configured-default"), 0);
  assert.equal(h.defaultWorkspaceFor("Alice"), "workspace-other");
});

test("soft-deleted membership history is never resurrected by identify or bootstrap", async () => {
  const h = nicknameIdentityStreamHarness();
  h.seedExistingUserWithDeletedMembership("Alice", "configured-default");
  assert.equal((await h.identify("Alice")).status, 403);
  assert.equal((await h.bootstrapDesktop("Alice", bootstrapAttempt())).status, 403);
  assert.equal(h.activeMembershipCount("Alice"), 0);
  assert.equal(h.createdDeviceCount, 0);
});

test("missing membership capability creates neither nickname user nor device", async () => {
  const h = nicknameIdentityStreamHarness({ memberships: undefined });
  const identify = await h.identify("Alice");
  const bootstrap = await h.bootstrapDesktop("Bob");
  assert.equal(identify.status, 503);
  assert.equal(bootstrap.status, 503);
  assert.equal((await identify.json()).error.code, "workspace_membership_unavailable");
  assert.equal(h.createdUserCount, 0);
  assert.equal(h.createdDeviceCount, 0);
});

test("revocation between route auth and connected writes no connected frame", async () => {
  const h = revokedDeviceStreamHarness();
  h.pauseAfterSubscribe();
  const response = await h.open();
  h.revokePresentedDevice();
  h.resumeAfterSubscribe();
  const result = await h.readUntilDone(response.body!.getReader(), 250);
  assert.doesNotMatch(result.text, /event: connected/u);
  assert.equal(result.done, true);
});

test("heartbeat reauthorization closes a revoked idle stream before ping", async () => {
  const h = revokedDeviceStreamHarness({ heartbeatMs: 5 });
  const response = await h.open();
  const reader = response.body!.getReader();
  await reader.read();
  h.revokePresentedDevice();
  const result = await h.readUntilDone(reader, 250);
  assert.doesNotMatch(result.text, /: ping/u);
  assert.equal(result.done, true);
});

for (const revocation of ["device", "session", "membership"] as const) {
  test(`locked frame serializes against ${revocation} revocation commit`, async () => {
    const h = realPgLockedStreamHarness(revocation);
    const reader = (await h.open()).body!.getReader();
    await reader.read();
    h.pauseAfterForShareAuthorizationBeforeStrictWrite();
    await h.publishPrivate("authorized-before-revoke");
    await h.frameGuardPaused;
    const revoke = h.revokeOnSecondConnection();
    assert.equal(await h.isPromisePending(revoke), true);
    h.resumeStrictWrite();
    assert.match(await h.readNextFrame(reader), /authorized-before-revoke/u);
    await revoke; // commit happens only after the authorized frame transaction commits
    await h.publishPrivate("must-not-cross-after-commit");
    const rest = await h.readUntilDone(reader, 250);
    assert.doesNotMatch(rest.text, /must-not-cross-after-commit/u);
    assert.equal(rest.done, true);
  });
}

test("revocation committed before locked authorization writes no frame", async () => {
  const h = realPgLockedStreamHarness("device");
  h.pauseBeforeFrameTransaction();
  const reader = (await h.open()).body!.getReader();
  await h.revokeOnSecondConnection();
  h.resumeFrameTransaction();
  const result = await h.readUntilDone(reader, 250);
  assert.doesNotMatch(result.text, /event: connected/u);
});

test("topic access row change is locked through strict frame enqueue", async () => {
  const h = realPgLockedTopicHarness("proposal");
  const reader = (await h.open()).body!.getReader();
  h.pauseAfterTopicRowsLocked();
  await h.publishPrivate("pre-change");
  const removeAccess = h.removeWorkItemAccessOnSecondConnection();
  assert.equal(await h.isPromisePending(removeAccess), true);
  h.resumeStrictWrite();
  await h.readNextFrame(reader);
  await removeAccess;
  await h.publishPrivate("post-change-secret");
  assert.doesNotMatch((await h.readUntilDone(reader, 250)).text, /post-change-secret/u);
});

test("strict writer rejection is observable and never reports a sent frame", async () => {
  const h = strictWriterStreamHarness();
  h.rejectNextEnqueue(new Error("consumer closed"));
  const result = await h.openAndRead();
  assert.equal(result.done, true);
  assert.equal(h.sentFrameCount, 0);
  assert.equal(h.logCount("sse_stream_write_failed"), 1);
  assert.equal(h.cleanupCalls, 1);
});

test("slow and timed-out reauthorization is observable and fail-closed", async () => {
  const h = revokedDeviceStreamHarness({ streamAuthTimeoutMs: 20, streamAuthSlowMs: 5 });
  const response = await h.open();
  const reader = response.body!.getReader();
  await reader.read();
  h.delayNextAuthorization(25);
  await h.publishPrivate("must-not-cross");
  const result = await h.readUntilDone(reader, 250);
  assert.doesNotMatch(result.text, /must-not-cross/u);
  assert.equal(h.logCount("sse_stream_auth_slow"), 1);
  assert.equal(h.logCount("sse_stream_auth_timeout"), 1);
  assert.equal(h.maxConcurrentAuthorizationChecks, 1);
});

test("representative event load performs one sequential check per write", async () => {
  const h = revokedDeviceStreamHarness();
  const response = await h.open();
  const reader = response.body!.getReader();
  await reader.read();
  for (let index = 0; index < 100; index += 1) {
    await h.publishPrivate(`event-${index}`);
  }
  await h.readEvents(reader, 100);
  assert.equal(h.authorizationChecks, 101); // connected + 100 events
  assert.equal(h.maxConcurrentAuthorizationChecks, 1);
});
~~~

- [ ] **Step 2: Run focused tests and record RED**

~~~bash
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="already-open|reauthorization|membership|connected|heartbeat|representative" \
  src/push.test.ts
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="desktop-bootstrap|pending device|activation|cancel" \
  src/auth.test.ts
~~~

Expected: RED because streams only authorize at open and bootstrap currently returns an immediately active device.

- [ ] **Step 3: Repair identity provisioning and define locked stream resolution**

First repair the identity source so strict streams do not break first-run users without expanding workspace access. Add transaction-bound repository `ensureIdentityDefaultForUser({ userId, configuredWorkspaceId, role, userCreated })` with this exact policy:

1. return the existing active default membership;
2. if one or more active memberships exist but none is default, promote exactly one deterministic existing row (`created_at`, then `id`) and never insert the configured workspace;
3. if no active membership exists but any membership history exists, including only soft-deleted rows, return `workspace_membership_required` and never resurrect/insert;
4. only a newly created user or a proven legacy user with zero membership history may receive a new configured-default membership;
5. lock the user row with `SELECT ... FOR UPDATE` before inspecting/promoting/inserting membership, then re-read and fail unless exactly one active default exists; do not rely on recovering from a PostgreSQL unique violation inside an already-aborted transaction.

Add `AuthDependencies.atomicNicknameIdentityWrites`, implemented in production by one database transaction with `users.getOrCreateActiveByNickname`, `memberships.ensureIdentityDefaultForUser`, and (for desktop only) `bootstrapAttempts.createPending`. Both nickname `/identify` and `/desktop-bootstrap` require this capability before mutation. Admin-secret validation occurs before attempt creation inside the transaction; membership/attempt failure rolls back newly created rows. Missing capability is `503 workspace_membership_unavailable` and creates neither user nor attempt/device. An existing tombstoned-only user gets `403 workspace_membership_required`; a cross-workspace user keeps/promotes an existing membership and gains no configured-default access. Do not let Task 7 manually seed membership—the real identify/bootstrap path must establish only the authorized membership.

Migration `0046_repair_default_workspace_memberships.sql` follows the same non-expansion policy and is idempotent: promote one deterministic active row for users with active membership but no default; insert the configured default only for active users with **zero rows of membership history**; leave tombstoned-only users untouched. It never changes workspace id or undeletes a row. Add a real PostgreSQL migration/repository test for active cross-workspace rows, multiple active rows, truly missing history, soft-deleted history, rerun idempotence, role derivation (`owner` for admin, `member` otherwise), and concurrent identify/bootstrap proving exactly one default without an aborted identity transaction.

Then make desktop issuance crash-safe with a structural boundary. Migration `0047_client_device_bootstrap_attempts.sql` creates `client_device_bootstrap_attempts`; pending credentials never exist in `client_devices`, so an ordinary auth lookup cannot accidentally accept one by omitting a predicate. Ordinary auth/SSE does not query the attempts table and therefore returns the existing non-enumerating `invalid_client_token` for pending tokens. The table contains attempt UUID, SHA-256 cancel-secret/request/token/client-key hashes, normalized nickname hash, state (`pending|activated|cancelled|expired`), optional user/device metadata, server expiry and terminal timestamps, and a linked device id after activation. It has state-shape checks, partial unique indexes on reserved device/token hashes, live-attempt/client indexes, and a pending-expiry index. Existing `client_devices` remain unchanged and active; there is no nullable-state backfill.

`POST /api/auth/desktop-bootstrap` now requires a client-generated UUID `bootstrap_attempt_id` plus a 256-bit base64url `bootstrap_cancel_secret`. Under the same user/membership transaction, it hashes the secret and normalized non-secret request, reserves device id/token hash in a five-minute pending attempt, and returns `202` with actor, reserved device id, opaque pending token, attempt id, and server expiry; it does **not** create `client_devices`. Reusing an attempt returns non-secret `409 bootstrap_attempt_conflict`, never remints and never replays the raw token. A lost response is resolved by probe/cancel, not blind start retry.

Add capability routes `POST /api/auth/desktop-bootstrap/probe`, `/activate`, and `/cancel`, explicitly documented and CSRF-exempt alongside start. Probe/cancel require attempt id+secret; activation additionally requires the pending token header. All use the same `SELECT ... FOR UPDATE` attempt-row lock and non-enumerating `bootstrap_attempt_invalid` for secret/token/request mismatch. Activation atomically inserts the reserved id/token hash into `client_devices`, links it, and marks activated; exact replay returns the same non-secret device result and never revives a later-revoked device. Cancel is terminal and idempotent: it cancels pending, and if activation already committed but its response was lost, it revokes the linked active device in the same transaction before marking cancelled. Activate/cancel races serialize so a successful cancel guarantees the token cannot authenticate afterward.

Cancel-before-start is also safe: `/cancel` may insert a short-lived cancellation tombstone containing attempt id and secret hash. A later start with that attempt locks/hits the tombstone and rolls back; if start wins first, cancel waits then cancels it. Pending expiry is fail-closed at `expires_at <= now` only for `pending -> activated`; probe/activate mark pending expired. Once activated, the linked attempt remains queryable/cancellable beyond that timestamp so an interrupted client can still revoke the linked device. Retention cleanup may delete only terminal attempts after a documented recovery window and never while a linked device is active.

Capability entropy prevents takeover, not write amplification. Add injectable `DesktopBootstrapThrottle` with a bounded LRU and stable client-key derivation from the same trusted-proxy policy as admin throttle: separate start and capability-route buckets, explicit maximum entries, 429/retry-after, and structured count/outcome logs. The transaction also enforces at most five live pending attempts per client-key hash and normalized nickname; it takes a transaction-scoped PostgreSQL advisory lock on the hashed quota key **before** count+insert, so simultaneous sixth starts cannot overshoot. Nonexistent-attempt cancel tombstones expire after ten minutes; opportunistic cleanup deletes at most a fixed batch per request, and an explicit maintenance method handles the remainder. Start/probe/activate/cancel all pass throttle before hashing/DB mutation. Tests exhaust each bucket, prove LRU memory bound, prove a random-attempt cancel flood cannot exceed rate/live limits, prove concurrent sixth+ starts leave exactly five in real PostgreSQL, and prove legitimate exact retry remains possible after Retry-After.

`DesktopBootstrapServiceError` owns stable status/code mapping instead of parsing localized message text. Update contracts/OpenAPI/CSRF/route-posture tests for the start/probe/activate/cancel request and responses. Real repository tests prove pending token absence from `client_devices`, duplicate start, activation/cancel idempotency, wrong-secret/token denial, exact-boundary expiry, cancel-before-start, activation-vs-cancel row locking, active-device revocation after lost activation response, and fresh/replayed migration. API tests prove pending token cannot call `/me`, an ordinary route, or receive an SSE `connected` frame; activation immediately enables strict `/me`; successful cancel makes every later auth attempt fail.

`scripts/qa/desktop-identity-db-pg.ts` is the non-skippable PostgreSQL 16 proof: it starts a uniquely named/ported temporary container, sets `DATABASE_URL` and `WORKHUB_MIGRATION_AUDIT_REQUIRE_DB=true`, applies the full migration chain to a fresh database, reruns the migration audit, then executes real membership, bootstrap-attempt, stream-authorization repository, and two-connection API race suites against that database. It verifies every 0048 trigger and advisory-lock direction. It fails if Docker/PG is unavailable and always cleans up in `finally`; no `if (!DATABASE_URL) return` path is accepted.

~~~ts
async function resolveStreamUserInternal(
  c: Context,
  deps: AuthDependencies,
  options: { touch: boolean }
): Promise<StreamUser> {
  const clientTokenHeader = readLocalClientToken(c);
  const byToken = await resolveUserFromClientToken(deps, clientTokenHeader, {
    touchDevice: options.touch
  });
  if (byToken) {
    if (options.touch) await deps.touchUser?.(byToken.user.id);
    return toStreamUser(deps, byToken.user);
  }
  if (clientTokenHeader && clientTokenHeader.trim().length > 0) {
    throw new HTTPException(403, { message: "invalid client token" });
  }
  const cookieToken = await readCookieToken(c, getAuthSettings(deps));
  if (cookieToken) {
    const now = (deps.now ?? (() => new Date()))();
    const user = await resolveUserFromCookie(deps, cookieToken, now, {
      touchSession: options.touch
    });
    if (user) {
      if (options.touch) await deps.touchUser?.(user.id);
      return toStreamUser(deps, user);
    }
  }
  throw new HTTPException(401, { message: "not identified" });
}

async function resolveRequiredStreamTenant(
  deps: AuthDependencies,
  user: UserAuthRow
) {
  if (!deps.memberships) {
    throw new HTTPException(503, {
      message: streamMembershipUnavailableMessage
    });
  }
  const tenant = await deps.memberships.resolveDefaultTenant(user.id);
  if (!tenant) {
    throw new HTTPException(403, {
      message: streamWorkspaceMembershipRequiredMessage
    });
  }
  return tenant;
}

async function toStreamUser(deps: AuthDependencies, user: UserAuthRow) {
  const tenant = await resolveRequiredStreamTenant(deps, user);
  return {
    id: user.id,
    nickname: user.nickname,
    isAdmin: user.isAdmin,
    orgId: tenant.orgId,
    workspaceId: tenant.workspaceId
  };
}

export function resolveStreamUser(c: Context, deps: AuthDependencies) {
  return resolveStreamUserInternal(c, deps, { touch: true });
}
~~~

Refactor the two private credential helpers so reauthorization is genuinely read-only:

~~~ts
async function resolveUserFromClientToken(
  deps: AuthDependencies,
  rawToken: string | undefined,
  options: { touchDevice: boolean } = { touchDevice: true }
) {
  const token = rawToken?.trim();
  if (!token) return null;
  const device = await deps.devices.findActiveByTokenHash(hashClientToken(token));
  if (!device) return null;
  const user = await deps.users.findActiveById(device.userId);
  if (!user) return null;
  if (options.touchDevice && getAuthSettings(deps).auth.touchDeviceOnAuth) {
    await deps.devices.touchLastSeen(device.id, (deps.now ?? (() => new Date()))());
  }
  return { user, device };
}
~~~

Add `touchSession` to the general cookie helper and touch only during initial route opening. Per-frame locked authorization is implemented by the transaction-bound stream repository and performs zero last-seen/session/user writes. Do not change `resolveHumanActor` in this batch: its migration fallback serves non-stream routes. Only stream opening/locked resolution becomes strict. Missing transaction/membership storage is 503; no active/default membership, including soft-deleted membership, is 403. Update every pre-existing fixture to provide explicit active membership rather than weakening production resolution.

- [ ] **Step 4: Consolidate stream opening and validation**

~~~ts
async function openAuthorizedStream(
  c: Context,
  selector: StreamTopicSelector,
  input: OpenStreamDependencies
) {
  const opened = await resolveOpenedStreamAuthorization(c, input.authDeps, selector);
  const authorizeAndWrite: WriteEventStreamOptions["authorizeAndWrite"] =
    (frame, strictWrite) => input.authDeps.streamAuthorization
      .withLockedFrame({ opened, selector, frame }, strictWrite);
  return writeEventStream(c, input.bus, input.presence, opened.topic, opened.user, {
    ...input.stream,
    authorizeAndWrite,
  });
}
~~~

`resolveOpenedStreamAuthorization` performs the normal touched open and captures only non-secret credential kind/id, user id, tenant, selector, and topic—never raw token/cookie. Production requires `streamAuthorization`; missing transaction capability is `503 stream_authorization_transaction_unavailable`. Use this for all seven routes. Expected credential/membership/topic denial logs `sse_stream_auth_revoked`; lock timeout and repository failures are separate stable outcomes.

`packages/db/src/repositories/stream-authorization.ts` is the stream authorization SSOT. Each frame opens one PostgreSQL transaction, first sets local `lock_timeout`, `statement_timeout`, and `idle_in_transaction_session_timeout`, **then** obtains the fixed shared transaction advisory lock, so waiting on an exclusive mutation fence is bounded. It next locks/reads with `FOR SHARE` (never `FOR KEY SHARE`) in one order: presented device/session → user → active default membership/workspace → selector root (`agent_runs`/`proposals` when present) → work-item access rows/assignments → project. It recomputes the exact principal/topic authorization from those locked rows. All ids within a class sort lexically. Missing/changed rows deny before write. A real PG test holds the exclusive fence and proves the frame exits within deadline as `stream_auth_lock_timeout` with no enqueue.

Move `StreamTopicRequest` into `@workhub/contracts` and remove `createDefaultTopicAccess`'s production service composition from push routes. `topic-access.ts` becomes a thin HTTP error/test adapter over canonical selector/result types; production open and every frame call the same transaction repository policy, preventing a service-based open check from drifting from DB-locked reauthorization. Contract tests run every selector through open and frame paths against identical fixtures and require the same topic/deny result.

Migration `0048_stream_authorization_write_fence.sql` creates a statement-level `BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE` trigger on every authorization-defining table (`client_devices`, `sessions`, `users`, `workspace_memberships`, `workspaces`, `projects`, `work_items`, `work_item_assignments`, `work_item_workspaces`, `agent_runs`, `proposals`). The trigger takes the matching **exclusive** transaction advisory lock before the statement changes/locks rows and holds it to commit. Thus app, another API process, or direct SQL mutation serializes with frame transactions without relying on every caller remembering a wrapper. The migration is idempotent, trigger/table inventory is asserted against the repository's locked-read inventory, and adding a new access table without both entries fails an audit.

The shared advisory lock is held through strict frame enqueue and transaction commit. If a frame wins, revocation waits and the frame is ordered before revocation commit; if revocation wins, the later frame sees denial. Lock/deadlock/statement timeout aborts before write and logs `stream_auth_lock_timeout`/repository failure. Real two-connection PostgreSQL tests cover device, session, membership, proposal/work-item access, both race directions, and trigger inventory.

- [ ] **Step 5: Check auth before heartbeat/event output**

~~~ts
export type WriteEventStreamOptions = {
  heartbeatMs?: number;
  presenceRefreshMs?: number;
  streamAuthTimeoutMs?: number;
  streamAuthSlowMs?: number;
  authorizeAndWrite: (
    frame: {
      stage: "connected" | "heartbeat" | "event";
      deadline_monotonic_ms: number;
      signal: AbortSignal;
    },
    strictWrite: (signal: AbortSignal) => Promise<void>
  ) => Promise<"written" | "denied">;
};
~~~

`authorizeAndWrite` is required. `writeEventStream` derives one monotonic deadline and abort controller per frame from the configured timeout; repository and writer receive that exact context and recompute remaining time before every await. A runtime shape assertion rejects missing/invalid deadline/signal/callback as `stream_authorize_and_write_required`. Change `PushRoutesDependencies.stream` to `Omit<WriteEventStreamOptions, "authorizeAndWrite">`, so callers may tune timing/logger but cannot inject/omit the boundary; only `openAuthorizedStream` supplies it, spread last.

Replace Hono's `StreamingApi.write()` on this security path: that helper catches `writer.write` rejection and returns success. `StrictSseWriter` owns the raw `ReadableStream` controller/writer, exposes awaited `enqueueFrame`, and makes closed/aborted/backpressure/write failure observable. It never catches and reports success. `writeEventStream` passes `enqueueFrame` into `authorizeAndWrite`; the database transaction commits only after strict enqueue succeeds. Rejection logs `sse_stream_write_failed`, increments no sent counter, and enters the one `finally` cleanup owner.

After subscription, connected/heartbeat/event each calls `authorizeAndWrite` once with no cache and no overlap. Presence refresh that can expose activity occurs inside the same guarded callback. Export defaults `STREAM_AUTH_TIMEOUT_MS = 2_000` and `STREAM_AUTH_SLOW_MS = 250`. Expected denial logs revoked; lock/statement/outer timeout closes fail-closed; repository and strict-write errors remain distinct. Include request id, user id, topic, phase, duration, outcome, sanitized error class/allowlisted driver code, never raw driver text or hashes.

Pass one deadline/abort state through the frame guard, transaction, and strict enqueue. Set PostgreSQL local `lock_timeout`, `statement_timeout`, and `idle_in_transaction_session_timeout`; on outer timeout abort/close the writer, prevent a not-yet-started write, and **await transaction rollback/completion** before returning—never detach a promise that may write later. A frame transaction has no automatic retry because enqueue is a non-replayable side effect; unknown commit outcome closes/logs sanitized state and never resends. If strict write already began, the shared advisory lock remains held until enqueue+commit, so revocation commit still orders after that frame. The direct load test counts 101 serial frame transactions for connected+100 events; instrument actual SQL query count, lock wait, max concurrency, p50/p95 transaction and enqueue latency. This correctness gate accepts one short transaction per frame for the Pilot.

Update all seven push-route OpenAPI entries with `401 not_identified`, their existing topic-specific 403 reasons plus `workspace_membership_required`, and `503 stream_membership_unavailable`; add app-level schema assertions so documentation cannot drift.

- [ ] **Step 6: Run API verification and commit**

~~~bash
pnpm --filter @workhub/api exec node --import tsx --test src/push.test.ts
pnpm --filter @workhub/api exec node --import tsx --test src/sse/strict-writer.test.ts
pnpm --filter @workhub/api test
pnpm --filter @workhub/api typecheck
pnpm --filter @workhub/contracts test
pnpm --filter @workhub/contracts typecheck
pnpm --filter @workhub/api-client test
pnpm --filter @workhub/api-client typecheck
pnpm --filter @workhub/db test
pnpm --filter @workhub/db typecheck
pnpm --filter @workhub/web test
pnpm --filter @workhub/web typecheck
pnpm --filter @workhub/db exec node --import tsx --test src/memberships-repository.test.ts
pnpm --filter @workhub/db exec node --import tsx --test src/device-bootstrap-attempts.test.ts
pnpm --filter @workhub/db exec node --import tsx --test src/stream-authorization.test.ts
pnpm --filter @workhub/db exec node --import tsx --test src/schema.test.ts
pnpm --filter @workhub/db test
pnpm --filter @workhub/db typecheck
pnpm audit:migrations
pnpm qa:desktop-identity-db-pg
git diff --check
~~~

Expected: all exit `0` and post-revoke payload never appears.

~~~bash
git add apps/api/src/middleware/auth.ts \
  apps/api/src/middleware/csrf.ts \
  apps/api/src/middleware/desktop-bootstrap-throttle.ts \
  apps/api/src/desktop-bootstrap-throttle.test.ts \
  apps/api/src/routes/auth.ts \
  apps/api/src/services/desktop-bootstrap.ts \
  apps/api/src/app.ts \
  apps/api/src/routes/push.ts \
  apps/api/src/sse/stream.ts \
  apps/api/src/sse/topic-access.ts \
  apps/api/src/sse/strict-writer.ts \
  apps/api/src/sse/strict-writer.test.ts \
  apps/api/src/push.test.ts \
  apps/api/src/stream-authorization-pg.test.ts \
  apps/api/src/auth.test.ts \
  apps/api/src/http-error-codes.ts \
  apps/api/src/openapi.ts \
  apps/api/src/app.test.ts \
  apps/api/src/csrf.test.ts \
  apps/api/src/route-auth-posture.test.ts \
  packages/contracts/src/auth.ts \
  packages/contracts/src/push.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/contracts.test.ts \
  packages/db/src/index.ts \
  packages/db/src/schema/core.ts \
  packages/db/src/schema.test.ts \
  packages/db/src/repositories/device-bootstrap-attempts.ts \
  packages/db/src/repositories/stream-authorization.ts \
  packages/db/src/repositories/memberships.ts \
  packages/db/src/device-bootstrap-attempts.test.ts \
  packages/db/src/stream-authorization.test.ts \
  packages/db/src/memberships-repository.test.ts \
  packages/db/migrations/0046_repair_default_workspace_memberships.sql \
  packages/db/migrations/0047_client_device_bootstrap_attempts.sql \
  packages/db/migrations/0048_stream_authorization_write_fence.sql \
  packages/db/migrations/meta/_journal.json \
  scripts/qa/desktop-identity-db-pg.ts \
  package.json
git commit -m "fix(api): harden device identity and active streams"
~~~

---

### Task 4: Build Desktop identity orchestration

**Files:**
- Create: `apps/desktop-webview/src/desktop-identity.ts`
- Create: `apps/desktop-webview/src/desktop-identity.test.ts`
- Create: `apps/desktop-webview/src/desktop-identity-store.ts`
- Create: `apps/desktop-webview/src/desktop-identity-store.test.ts`
- Modify: `apps/desktop-webview/src/browser.ts:128-219`
- Modify: `apps/desktop-webview/src/spotlight/views/drive.ts`
- Modify: `apps/desktop-webview/src/spotlight/views/drive.test.ts`
- Modify: `apps/desktop-webview/src/main.test.ts`
- Modify: `apps/web/src/main.test.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/types.ts`
- Modify: `packages/api-client/src/api-client.test.ts`

**Interfaces:**
- Consumes: Task 2 begin/mark/finalize/recovery commands and Task 3 pending-device activate/cancel protocol.
- Produces: async `DesktopIdentityPrivateStoreBridge` with Rust-authoritative native and explicitly non-certified browser adapters, crash-safe bootstrap attempt/quarantine, `resolveDesktopBootIdentity`, `initializeDesktopIdentity`, two-phase `runDesktopIdentityTransition`, `logoutDesktopIdentity`, and `rebindDesktopIdentity`.

- [ ] **Step 1: Write failing server-error and ordering tests**

Canonical parser fixtures use real UUIDs; readable labels are never written into v2 records:

~~~ts
const ACTOR_A_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_B_ID = "10000000-0000-4000-8000-000000000002";
const DEVICE_B_ID = "20000000-0000-4000-8000-000000000002";
const ATTEMPT_B_ID = "30000000-0000-4000-8000-000000000002";
~~~

~~~ts
test("logout failure preserves A only after a successful post-error identity probe", async () => {
  const h = desktopIdentityHarness({ actorId: "actor-a", token: "token-a" });
  h.serverLogout.reject(new Error("network down"));
  h.identityProbe.resolve(identityFor("actor-a"));
  await assert.rejects(
    () => logoutDesktopIdentity(h.input()),
    (error: unknown) => desktopIdentityReason(error) === "server_logout_failed"
  );
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.identityRecordActor(), "actor-a");
  assert.equal(h.identityRecordHasToken(), true);
  assert.equal(h.shellCalls.length, 0);
  assert.equal(h.petMessages.length, 0);
});

test("logout error after server revocation still performs local teardown", async () => {
  const h = desktopIdentityHarness({ actorId: "actor-a", token: "token-a" });
  h.serverLogout.reject(new Error("response lost after revoke"));
  h.identityProbe.reject(apiError("invalid_client_token", 403));
  const logout = logoutDesktopIdentity(h.input());
  h.resolveRustBeginPrepared({ identity_generation: 2, status: "cleared" });
  h.resolvePetAck("prepare", 2);
  h.resolveRustMarkCommitted();
  h.resolvePetAck("commit", 2);
  h.resolveRustFinalize();
  await logout;
  assert.equal(h.identityRecordState(), "signed_out");
  assert.equal(h.identityRecordHasToken(), false);
});

test("logout error plus failed probe reports unknown state without claiming A is active", async () => {
  const h = desktopIdentityHarness({ actorId: "actor-a", token: "token-a" });
  h.serverLogout.reject(new Error("timeout"));
  h.identityProbe.reject(new Error("probe timeout"));
  await assert.rejects(
    () => logoutDesktopIdentity(h.input()),
    (error: unknown) => desktopIdentityReason(error) === "server_logout_state_unknown"
  );
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.shellCalls.length, 0);
});

test("signed-out persistence waits for Rust and Pet acknowledgements", async () => {
  const h = desktopIdentityHarness({ actorId: "actor-a", token: "token-a" });
  const logout = logoutDesktopIdentity(h.input());
  await h.serverLogout.completed;
  assert.equal(h.identityRecordState(), "bound");
  h.resolveRustBeginPrepared({ identity_generation: 2, status: "cleared" });
  assert.equal(h.identityRecordState(), "bound");
  h.resolvePetAck("prepare", 2);
  assert.equal(h.identityRecordState(), "signed_out");
  h.resolveRustMarkCommitted();
  h.resolvePetAck("commit", 2);
  h.resolveRustFinalize();
  await logout;
  assert.equal(h.identityRecordState(), "signed_out");
  assert.equal(h.identityRecordHasToken(), false);
});

test("silent Pet restarts once and a second silence destroys the stale surface", async () => {
  const h = desktopIdentityHarness({ actorId: "actor-a", token: "token-a" });
  h.neverAcknowledgePet();
  await assert.rejects(
    () => logoutDesktopIdentity(h.input()),
    (error: unknown) => desktopIdentityBoundaryState(error)
      === "server_revoked_local_incomplete"
  );
  assert.equal(h.petRestartCalls, 1);
  assert.equal(h.petDestroyCalls, 1);
  assert.equal(h.petSurfaceExists, false);
  assert.equal(h.nativeIdentity.status, "cleared");
  assert.ok(h.nativeIdentity.identity_generation > 1);
});

test("staged B cannot open any ordinary or Rust request before final readiness", async () => {
  const h = signedOutRebindHarness();
  const rebind = rebindDesktopIdentity(h.input("B"));
  h.resolveBootstrap(bootstrapResult("actor-b", "token-b"));
  h.resolveActivation();
  h.resolveRustBeginPrepared({ identity_generation: 3, status: "bound", actor_id: "actor-b" });
  assert.equal(h.rustRequestsFor("actor-b"), 0);
  assert.equal(h.ordinaryClientReadsFor("actor-b"), 0);
  h.resolvePetAck("prepare", 3);
  h.resolveRustMarkCommitted();
  assert.equal(h.rustRequestsFor("actor-b"), 0);
  h.resolvePetAck("commit", 3);
  assert.equal(h.identityRecordState(), "binding");
  h.resolveBoundPersistence();
  h.resolveRustFinalize();
  await rebind;
  assert.equal(h.rustRequestsFor("actor-b"), 1);
  assert.equal(h.identityRecordState(), "bound");
});

test("stored actor mismatch is never bound under a different valid token", async () => {
  const h = desktopBootIdentityHarness({ actorId: "actor-a", token: "token-b" });
  h.identityProbe.resolve(identityFor("actor-b"));
  await assert.rejects(
    () => initializeDesktopIdentity(h.input()),
    (error: unknown) => desktopIdentityReason(error)
      === "stored_identity_actor_mismatch"
  );
  assert.equal(h.rustBindCalls, 0);
  assert.equal(h.petMessages.length, 0);
  assert.equal(h.renderedState, "identity_diagnostic");
});

test("token-only legacy migration is Rust-durable before legacy deletion", async () => {
  const h = legacyIdentityStorageHarness({ token: "token-a" });
  h.throwOnLegacyRemoval("workhub_client_token");
  await assert.rejects(
    () => migrateLegacyDesktopIdentity(h.privateStore, h.legacyStorage),
    (error: unknown) => desktopIdentityReason(error)
      === "local_identity_legacy_cleanup_failed"
  );
  assert.equal(h.identityRecordState(), "needs_actor");
  assert.equal(h.identityRecordHasToken(), true);
  assert.equal(
    resolveDesktopBootIdentity(await h.privateStore.get()).state,
    "needs_actor"
  );
  assert.equal(h.privateStoreFsyncAckBeforeLegacyRemoval, true);
});

test("interrupted binding is compensated and never becomes active on boot", async () => {
  const h = desktopBootIdentityHarness({
    record: {
      version: 2,
      state: "binding",
      origin: "issued",
      actor_id: ACTOR_B_ID,
      device_id: DEVICE_B_ID,
      client_token: "token-b",
      attempt_id: ATTEMPT_B_ID,
      cancel_secret: validCancelSecret(),
      activation_expires_at: futureIso()
    }
  });
  await initializeDesktopIdentity(h.input());
  assert.equal(h.cancelledAttemptCount, 1);
  assert.equal(h.rustBindCalls, 0);
  assert.equal(h.identityRecordState(), "signed_out");
  assert.equal(h.renderedState, "signed_out");
});

test("interrupted existing-token binding is revalidated and retried, not revoked", async () => {
  const h = desktopBootIdentityHarness({
    record: {
      version: 2,
      state: "binding",
      origin: "existing",
      actor_id: ACTOR_A_ID,
      client_token: "token-a"
    }
  });
  h.identityProbe.resolve(identityFor("actor-a"));
  await initializeDesktopIdentity(h.input());
  assert.equal(h.cancelledAttemptCount, 0);
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.rustBindCalls, 1);
});

test("cold restart quarantines stored bound A before synchronizing cleared Rust and Pet", async () => {
  const h = desktopBootIdentityHarness({
    record: { version: 2, state: "bound", actor_id: ACTOR_A_ID, client_token: "token-a" },
    native: { phase: "stable", status: "cleared", generation: 2 }
  });
  h.identityProbe.resolve(identityFor(ACTOR_A_ID));
  const boot = initializeDesktopIdentity(h.input());
  await h.privateStoreReached("binding");
  assert.equal(h.ordinaryClientRequests, 0);
  assert.equal(h.petPrepareSawState, "binding");
  await h.completePrepareMarkCommitFinalize();
  await boot;
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.ordinaryClientEnabledAfterExactStableBound, true);
});

test("uncertain interrupted-binding revocation stays diagnostic", async () => {
  const h = desktopBootIdentityHarness({
    record: issuedBindingRecord("actor-b", "token-b", bootstrapAttemptMeta())
  });
  h.failCompensatingRevoke(new Error("network down"));
  await assert.rejects(
    () => initializeDesktopIdentity(h.input()),
    (error: unknown) => desktopIdentityBoundaryState(error)
      === "issued_identity_cleanup_unknown"
  );
  assert.equal(h.rustBindCalls, 0);
  assert.equal(h.identityRecordState(), "binding");
  assert.equal(h.renderedState, "identity_diagnostic");
});

test("bootstrap attempt is durable before the first mutating request", async () => {
  const h = signedOutRebindHarness();
  const rebind = rebindDesktopIdentity(h.input("B"));
  await h.bootstrapStarted;
  assert.deepEqual(h.steps.slice(0, 2), [
    "bootstrap_attempt_persisted",
    "bootstrap_request_started"
  ]);
  assert.equal(h.identityRecordState(), "bootstrap_pending");
  h.abortTest();
  await assert.rejects(() => rebind);
});

test("missing secure randomness fails before storage or network", async () => {
  const h = signedOutRebindHarness({ crypto: unavailableSecureCrypto() });
  await assert.rejects(
    () => rebindDesktopIdentity(h.input("B")),
    (error: unknown) => desktopIdentityReason(error)
      === "bootstrap_attempt_generation_failed"
  );
  assert.equal(h.canonicalWriteCalls, 0);
  assert.equal(h.bootstrapCalls, 0);
});

test("force quit after lost bootstrap response leaves only a cancellable non-auth credential", async () => {
  const h = signedOutRebindHarness();
  h.bootstrapCreatesPendingThenLosesResponse();
  await assert.rejects(() => rebindDesktopIdentity(h.input("B")));
  assert.equal(h.identityRecordState(), "bootstrap_pending");
  assert.equal(h.pendingTokenCanAuthenticate(), false);
  const restarted = h.restartFromDurableStorage();
  await initializeDesktopIdentity(restarted.input());
  assert.equal(restarted.cancelledAttemptCount, 1);
  assert.equal(restarted.identityRecordState(), "signed_out");
});

test("pending-activation quarantine write failure never activates the response token", async () => {
  const h = signedOutRebindHarness();
  h.throwOnPendingActivationWrite();
  await assert.rejects(() => rebindDesktopIdentity(h.input("B")));
  assert.equal(h.activateCalls, 0);
  assert.equal(h.cancelAttemptCalls, 1);
  assert.equal(h.pendingTokenCanAuthenticate(), false);
  assert.equal(h.identityRecordState(), "signed_out");
});

test("lost activation response probes active token and continues only for exact actor", async () => {
  const h = signedOutRebindHarness();
  h.activationCommitsThenLosesResponse();
  h.issuedIdentityProbe.resolve(identityFor("actor-b"));
  await h.completeRebind("B");
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.identityRecordActor(), "actor-b");
});

test("crash after activation is recovered by attempt cancel that revokes the linked device", async () => {
  const h = desktopBootIdentityHarness({
    record: issuedBindingRecord("actor-b", "token-b", bootstrapAttemptMeta())
  });
  await initializeDesktopIdentity(h.input());
  assert.equal(h.cancelAttemptCalls, 1);
  assert.equal(h.linkedActiveDeviceCount, 0);
  assert.equal(h.rustBindCalls, 0);
  assert.equal(h.identityRecordState(), "signed_out");
});

test("RecoveryRequired clears Pet in both phases before releasing the recovery lease", async () => {
  const h = desktopIdentityHarness({ actorId: "actor-a", token: "token-a" });
  h.rustBeginReturnsRecoveryRequired("system_notification_clear_failed", 2);
  await assert.rejects(() => logoutDesktopIdentity(h.input()));
  assert.deepEqual(h.petMessagePhases(), ["prepare", "commit"]);
  assert.equal(h.finalizeClearRecoveryCalls, 1);
  assert.equal(h.recoveryLeaseHeldUntilPetCommit, true);
  assert.equal(h.nativeIdentity.status, "cleared");
});

test("out-of-order or wrong-phase Pet result cannot satisfy the transition", async () => {
  const h = signedOutRebindHarness();
  const rebind = h.startActivatedRebind("actor-b", "token-b");
  h.emitPetAck("commit", 3);
  assert.equal(h.rustMarkCalls, 0);
  h.emitPetAck("prepare", 3);
  await h.rustMarked;
  h.emitPetAck("prepare", 3);
  assert.equal(h.rustFinalizeCalls, 0);
  h.emitPetAck("commit", 3);
  await rebind;
});
~~~

Also test:

- a first install with no token/actor returns `signed_out` and never auto-creates fixed nickname `WorkHub Desktop`;
- an existing token without actor returns `needs_actor`, a successful bounded `me()` persists actor and binds it, and a stale token becomes signed-out;
- an existing token+actor pair is still validated by bounded `me()` before binding; a different returned actor is `stored_identity_actor_mismatch`, performs no Rust/Pet bind, and renders a recovery diagnostic rather than silently switching users;
- the explicit `WORKHUB_CUU_QA_CLIENT_TOKEN` initializer writes only the shared Tauri-origin storage before boot; main enters `needs_actor`, resolves the real QA actor through bounded `/me`, and installs that token/actor through the same prepare/mark/commit/finalize path, while Pet cannot consume it before commit;
- `not_identified` and `invalid_client_token` continue teardown;
- unknown `403`, `5xx`, network failures, and timeouts require the post-error probe and may produce `server_logout_state_unknown`;
- native scope with missing invoke/listen/emitTo is a hard error;
- Pet timeout is `pet_identity_ack_timeout`;
- a silent Pet retries once through `restart_pet_identity_surface`; a second failure destroys the Pet WebView, proves it absent, and returns an error rather than leaving an A surface alive;
- a staged B transition opens zero Rust requests until finalize and zero ordinary client requests until the post-finalize `bound` write; any failure produces a later cleared generation sent through Pet prepare+commit before returning;
- main-WebView reload during Preparing, Committing, or Recovering resumes by the exact public transition descriptor; lost mark/finalize/recovery-finalize responses are reconciled by phase/snapshot/id rather than guessed;
- post-finalize `bound` persistence failure starts a fresh clear transition from Stable B and cancels the linked device;
- storage exception is `local_identity_persist_failed`;
- errors after server device revocation carry `server_revoked_local_incomplete`, while `server_logout_failed` carries `server_unchanged`;
- messages and errors never serialize token data.

- [ ] **Step 2: Run focused test and record RED**

~~~bash
pnpm --filter @workhub/desktop-webview exec node --import tsx --test \
  src/desktop-identity.test.ts src/desktop-identity-store.test.ts
~~~

Expected: module-not-found RED.

- [ ] **Step 3: Add abortable identity requests and one storage contract**

Extend only identity-sensitive API client calls:

~~~ts
export type IdentityRequestOptions = {
  signal?: AbortSignal;
};

me: (options?: IdentityRequestOptions) => Promise<MeResponse>;
revokeCurrentClientDevice: (options?: IdentityRequestOptions) => Promise<ClientDeviceResponse>;
bootstrapDesktop: (
  payload: DesktopBootstrapRequest,
  options?: IdentityRequestOptions
) => Promise<DesktopBootstrapResponse>;
probeDesktopBootstrap: (
  payload: DesktopBootstrapCapabilityRequest,
  options?: IdentityRequestOptions
) => Promise<DesktopBootstrapProbeResponse>;
activateDesktopBootstrap: (
  payload: DesktopBootstrapCapabilityRequest,
  options?: IdentityRequestOptions
) => Promise<DesktopBootstrapActivationResponse>;
cancelDesktopBootstrap: (
  payload: DesktopBootstrapCapabilityRequest,
  options?: IdentityRequestOptions
) => Promise<DesktopBootstrapProbeResponse>;
~~~

Forward `signal` into the underlying fetch `RequestInit` and test that aborting the supplied controller rejects each call with `AbortError`. `activateDesktopBootstrap` is invoked from a client scoped to the pending token; probe/cancel use the same API base/fetch/credential policy with no client token. Desktop logout uses `revokeCurrentClientDevice`, not `/api/auth/logout`, so signing out this Mac never rotates the user's nickname cookie or invalidates a Web session. Add a real route regression that the device becomes invalid while the existing cookie/session remains valid. Desktop orchestration uses:

~~~ts
export const DESKTOP_IDENTITY_REQUEST_TIMEOUT_MS = 8_000;
export const DESKTOP_IDENTITY_COMPENSATION_TIMEOUT_MS = 3_000;

function identityRequestSignal(timeoutMs: number) {
  return AbortSignal.timeout(timeoutMs);
}
~~~

Revoke/bootstrap/activation/probe timeout reason codes are `server_logout_timeout`, `rebind_timeout`, `client_device_activation_state_unknown`, and `server_logout_state_unknown` as applicable. A timed-out mutating request is always probed/compensated because abort does not prove the server did not finish.

Then centralize the private record schema behind one async store bridge:

~~~ts
export const desktopIdentityStorageKeys = {
  browserIdentityV2: "workhub_desktop_identity_v2",
  legacyToken: "workhub_client_token",
  legacyTokenAlias: "yqgl_client_token",
  legacyActorId: "workhub_desktop_actor_id",
  legacySignedOut: "workhub_desktop_logged_out"
} as const;

export type DesktopIdentityRecordV2 =
  | { version: 2; state: "signed_out" }
  | { version: 2; state: "needs_actor"; origin: "existing"; client_token: string }
  | {
      version: 2;
      state: "bootstrap_pending";
      attempt_id: string;
      cancel_secret: string;
    }
  | {
      version: 2;
      state: "pending_activation";
      attempt_id: string;
      cancel_secret: string;
      actor_id: string;
      device_id: string;
      client_token: string;
      activation_expires_at: string;
    }
  | {
      version: 2;
      state: "binding";
      origin: "existing";
      actor_id: string;
      client_token: string;
    }
  | {
      version: 2;
      state: "binding";
      origin: "issued";
      actor_id: string;
      device_id: string;
      client_token: string;
      attempt_id: string;
      cancel_secret: string;
      activation_expires_at: string;
    }
  | { version: 2; state: "bound"; actor_id: string; client_token: string };

export type DesktopIdentityPrivateRead =
  | { state: "uninitialized"; revision: 0 }
  | { state: "ready"; revision: number; record: DesktopIdentityRecordV2 };

export type DesktopIdentityPrivateWriteAck = {
  revision: number;
  state: DesktopIdentityRecordV2["state"];
};

export type DesktopIdentityPrivateStoreBridge = {
  get(): Promise<DesktopIdentityPrivateRead>;
  compareAndSwap(
    expectedRevision: number,
    record: DesktopIdentityRecordV2
  ): Promise<DesktopIdentityPrivateWriteAck>;
};

export function resolveDesktopBootIdentity(read: DesktopIdentityPrivateRead): DesktopBootIdentity {
  if (read.state === "uninitialized") return { state: "signed_out" };
  const record = parseDesktopIdentityRecordV2(read.record); // throws local_identity_record_invalid
  if (record.state === "signed_out") return { state: "signed_out" };
    if (record.state === "needs_actor") {
      return { state: "needs_actor", token: record.client_token };
    }
    if (record.state === "bootstrap_pending") {
      return {
        state: "bootstrap_pending",
        attemptId: record.attempt_id,
        cancelSecret: record.cancel_secret
      };
    }
    if (record.state === "pending_activation") {
      return {
        state: "pending_activation",
        actorId: record.actor_id,
        deviceId: record.device_id,
        token: record.client_token,
        attemptId: record.attempt_id,
        cancelSecret: record.cancel_secret,
        pendingExpiresAt: record.activation_expires_at
      };
    }
    if (record.state === "binding") {
      const base = {
        state: "interrupted_binding",
        actorId: record.actor_id,
        token: record.client_token,
        origin: record.origin
      } as const;
      return record.origin === "issued"
        ? {
            ...base,
            deviceId: record.device_id,
            attemptId: record.attempt_id,
            cancelSecret: record.cancel_secret,
            pendingExpiresAt: record.activation_expires_at
          }
        : base;
    }
  return { state: "bound", actorId: record.actor_id, token: record.client_token };
}
~~~

The native Tauri adapter maps `get/compareAndSwap` only to the three Rust private-store commands; it never calls localStorage for v2 state. CAS mismatch is `local_identity_revision_conflict` and exposes expected/current revision numbers only. Every orchestration function carries the latest revision and awaits the redacted Rust ack before its next network/native/Pet step. A malformed record is `local_identity_record_invalid` and blocks identity/network work; IO/fsync/rename failure is `local_identity_persist_failed`. The plain browser adapter alone serializes the same strict record into `browserIdentityV2` localStorage and is labelled non-crash-certified.

`readBoundDesktopIdentity(store)` is async and returns credentials only for `bound`, but main may enable the ordinary Browser/Drive/Settings client only when native is simultaneously Stable/Bound with the exact same actor/generation established by the current boot. Stable/Cleared is not enough. On cold restart with private `bound` and cleared Rust, main keeps ordinary clients disabled, probes `me`, CASes `bound -> binding(origin="existing")`, runs prepare/mark/commit/finalize, then CASes back to `bound`. Pet prepare therefore sees binding and no request escapes early. Pet never calls the main reader; it uses Rust's exact stable/transition private command. The record remains `binding` through Pet commit **and Rust finalize**. If final bound CAS fails, start a fresh ordinary clear transition from Stable B and compensate as appropriate.

Rust is authoritative, while `parseDesktopIdentityRecordV2` defensively validates IPC/browser-adapter objects: 16 KiB serialized cap, exact fields, safe revision, UUID actor/device/attempt ids, canonical 256-bit base64url cancel secret, parseable server expiry, non-empty token capped at 4 KiB, and no token/secret normalization beyond rejecting whitespace. Tests cover malformed/oversized/extra-field records, invalid capability/expiry, CAS conflict/overflow, and redacted errors.

Legacy localStorage keys are read only when the Rust store returns `uninitialized`. Migration derives signed-out/token+actor/token-only state, awaits Rust CAS from revision 0 and its fsync-backed ack, then attempts every legacy-key removal independently. It never writes native v2 to Web Storage. Cleanup failure is `local_identity_legacy_cleanup_failed`: the Rust record remains authoritative and boot retries only cleanup visibly. The Cuu smoke initializer intentionally writes the legacy token once, exercising this path. Plain browser migration writes its non-certified browser adapter first, then deletes legacy keys.

Create the repository-wide identity-storage audit only in Task 6, after Settings, Pet, Browser, Drive, and Cuu have all migrated. Task 4's focused tests instead assert its changed Browser/Drive paths use the canonical readers; it must not install a root lint gate that is knowingly red on not-yet-migrated Task 5/6 files.

Do not swallow store/parser errors in this security boundary; the caller renders a visible diagnostic. `needs_actor` creates a token-scoped API client, calls bounded `me()`, then uses the same two-phase transition as rebind: await private-store CAS to `binding(origin="existing")`, keep it non-readable to ordinary clients through Rust finalize, and only then CAS to `bound`. A stored `bound` pair also calls bounded `me()` and requires an exact actor match before installing it into an initially cleared Rust process.

Boot recovery is explicit and starts no Rust/Pet private work: `bootstrap_pending` probes/cancels the persisted attempt; `pending_activation` probes exact attempt/actor/device, retries the same activation when still pending, or cancels when active/unknown cleanup is requested; `binding(origin="issued")` is never rebound and is canceled through its attempt capability, which also revokes a linked active device. Only a confirmed cancelled/revoked/expired attempt may become signed-out. Unknown response/probe state preserves the exact recovery record and mounts a recovery-only diagnostic. `binding(origin="existing")` is revalidated with bounded `me()` and safely retried because it was not minted by the failed flow. Actor mismatch or network/5xx never substitutes identities. No path auto-creates `WorkHub Desktop`.

The existing Cuu-smoke-only token path follows this same migration rather than becoming a second Rust authority. Keep `WORKHUB_CUU_QA_CLIENT_TOKEN` in `CuuQaPreferenceOverrides` for those older smoke scripts, inject it into shared Tauri-origin storage before main boot, and assert main reaches `needs_actor -> bound` through real `/me`. Pet startup uses `get_public_client_identity` and cannot open a direct stream merely because the initializer populated storage. Task 7's native identity gate explicitly forbids this shortcut and uses production pending activation. `WORKHUB_CLIENT_TOKEN` and `YQGL_CLIENT_TOKEN` remain rejected.

- [ ] **Step 4: Implement acknowledged Rust/Pet bridge**

~~~ts
export type DesktopIdentityNativeBridge = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (
    event: string,
    handler: (event: { payload: unknown }) => void
  ) => Promise<() => void>;
  emitTo: (label: string, event: string, payload: unknown) => Promise<void>;
};
~~~

`runDesktopIdentityTransition`:

1. Call main-only `get_client_identity`. A stable read supplies `expected_generation`. If an active Preparing/Committing transition survived a main-WebView reload, use its exact public `active_transition.transition_id` to enter clear recovery; if Recovering, resume that recovery; if Degraded, begin clear recovery. Synchronize Pet clear `prepare` then `commit` (or prove destruction), finalize clear recovery, and only then restart the requested operation. `get_public_client_identity` exposes only snapshot/phase to Pet and never exposes mutation authority.
2. Invoke `begin_client_identity_change`, validate exact shapes/counts, and anchor `deadline = performance.now() + lease_remaining_ms` immediately on receipt. `Prepared` continues. `RecoveryRequired` skips requested work, synchronizes the returned clear recovery through both Pet phases, finalizes it, preserves/cleans canonical credentials according to confirmed server state, and throws the original `reason_code`.
3. Install the result listener before emit. Send `{change_id, phase:"prepare", snapshot}` and accept only the exact id/generation/phase. Pet prepare advances its floor and proves old work is gone but starts zero target work. A stable nack fails immediately. Silence restarts Pet once and replays prepare; a second silence destroys and verifies the surface.
4. Run `afterPrepareBeforeMark`: clear/logout awaits private-store CAS to signed-out here; bind already has an fsync-acknowledged `binding` quarantine. Check the monotonic browser deadline before and after the awaited CAS and use its returned revision.
5. Invoke `mark_client_identity_committed`; require the same snapshot and public phase `committing`. The target token is now the committed Rust credential but all Rust effects remain blocked by the lease.
6. Send exact `phase:"commit"` and wait for exact Pet ready ack. If Pet restarted during commit, replay **prepare then commit** for that same id/generation so the new surface cannot accept commit without proving quiescence. Pet may now create the B scope from private transition storage; clear shows neutral signed-out state.
7. Invoke `finalize_client_identity_change`. Only this releases the Rust lease and broadcasts Committed. For bind, await private-store CAS from `binding` to `bound` only after finalize resolves; ordinary Browser/Drive/Settings readers therefore stay blocked throughout Preparing/Committing. If this final CAS fails, Rust is already Stable B, so start a **fresh ordinary clear transition** from that exact stable generation, run Pet clear prepare/commit and finalize, then compensate the issued attempt; `begin_clear_recovery` is reserved for a still-active/degraded lease. Never leave a visible successful B.
8. On any failure before successful final persistence, invoke `begin_client_identity_clear_recovery` with the failed transition id (or use the already-returned recovery), keep that lease held, send clear `prepare` then `commit`, and call `finalize_client_identity_clear_recovery` only after Pet commit ack. If Pet cannot ack after one restart, destroy it and require confirmed absence before finalizing. Canonical state becomes signed-out only when server cancellation/revocation is confirmed; otherwise retain exact pending/issued recovery material and mount a recovery-only diagnostic.
9. Every rejected/lost IPC response is reconciled with a fresh main-only read before deciding recovery: exact Preparing id resumes prepare; exact Committing id resumes Pet commit; Stable exact target means finalize committed; Recovering exact id resumes clear; Stable cleared after recovery-finalize means success. Any other id/snapshot/phase mismatch enters or starts clear as appropriate. Then remove every listener/retry timer in `finally`; stable nacks, wrong-phase results, out-of-order results, stale generations, and other change ids never satisfy a waiter.

No second clear/bind can begin until requested finalize or recovery finalize. Tests cover concurrent callers, stale expected generations, reload during each Preparing/Committing/Recovering phase, Pet restart during commit, wrong-phase/out-of-order results, lease expiry, typed `RecoveryRequired`, lost mark/finalize/recovery-finalize responses, post-finalize bound-write failure through a fresh clear transition, and a recovery lease held until Pet clear commit or confirmed destruction.

Plain browser development uses an explicit non-Tauri async adapter over localStorage with no Rust/Pet/native force-kill evidence claim and is separately labelled in tests. If `__TAURI__` exists but coordinator or private-store commands are incomplete, fail with `shell_identity_clear_failed`.

- [ ] **Step 5: Implement ordered logout**

~~~ts
export async function logoutDesktopIdentity(input: LogoutDesktopIdentityInput) {
  const read = await input.privateStore.get();
  const identity = readBoundDesktopIdentity(read);
  if (!identity) {
    throw new DesktopIdentityError("local_identity_record_invalid", "server_state_unknown");
  }
  const client = input.createTokenScopedClient(identity.clientToken);
  let serverRevoked = false;
  try {
    await client.revokeCurrentClientDevice({
      signal: identityRequestSignal(DESKTOP_IDENTITY_REQUEST_TIMEOUT_MS)
    });
    serverRevoked = true;
  } catch (error) {
    if (serverIdentityAlreadyAbsent(error)) {
      serverRevoked = true;
    } else {
      try {
        const me = await client.me({
          signal: identityRequestSignal(DESKTOP_IDENTITY_REQUEST_TIMEOUT_MS)
        });
        if (me?.id === identity.actorId) {
          throw new DesktopIdentityError(
            error instanceof DOMException && error.name === "TimeoutError"
              ? "server_logout_timeout"
              : "server_logout_failed",
            "server_unchanged",
            error
          );
        }
        serverRevoked = !me;
      } catch (probeError) {
        if (serverIdentityAlreadyAbsent(probeError)) {
          serverRevoked = true;
        } else if (probeError instanceof DesktopIdentityError) {
          throw probeError;
        } else {
          throw new DesktopIdentityError(
            "server_logout_state_unknown",
            "server_state_unknown",
            probeError
          );
        }
      }
    }
  }
  if (!serverRevoked) {
    throw new DesktopIdentityError(
      "server_logout_state_unknown",
      "server_state_unknown"
    );
  }
  return runDesktopIdentityTransition({
    native: input.native,
    token: undefined,
    actorId: undefined,
    timeoutMs: input.timeoutMs,
    async afterPrepareBeforeMark() {
      try {
        await input.privateStore.compareAndSwap(read.revision, {
          version: 2, state: "signed_out"
        });
      } catch (error) {
        const reason = desktopIdentityReason(error);
        throw new DesktopIdentityError(
          isStablePrivateStoreReason(reason)
            ? reason
            : "local_identity_persist_failed",
          "server_revoked_local_incomplete",
          error
        );
      }
      const legacyFailures = cleanupLegacyDesktopIdentityKeys(input.legacyStorage);
      if (legacyFailures.length > 0) {
        throw new DesktopIdentityError(
          "local_identity_legacy_cleanup_failed",
          "server_revoked_local_incomplete",
          legacyFailures
        );
      }
    }
  });
}
~~~

`isStablePrivateStoreReason` preserves `local_identity_revision_conflict`, `local_identity_revision_overflow`, `local_identity_record_invalid`, and `local_identity_persist_failed`; wrappers change only unknown IO exceptions to persist-failed. No CAS wrapper may erase the real stable root cause.

`DesktopIdentityError` exposes a non-secret `boundary_state`:

~~~ts
type DesktopIdentityBoundaryState =
  | "server_unchanged"
  | "server_state_unknown"
  | "server_revoked_local_incomplete"
  | "issued_identity_cleanup_unknown";
~~~

`server_logout_failed` uses `server_unchanged` only after a successful same-actor probe. A failed probe uses `server_state_unknown`. Any Rust/Pet/storage failure after confirmed device revocation is wrapped with `server_revoked_local_incomplete`, so Settings can tell the truth about a partial logout. Tests prove the presented device is revoked, an existing browser cookie/session for the same user remains valid, and no `/api/auth/logout` request is made.

- [ ] **Step 6: Write failing B rebind/rollback tests**

~~~ts
test("B becomes readable only after pending activation, two Pet phases, and Rust finalize", async () => {
  const h = signedOutRebindHarness();
  const rebind = rebindDesktopIdentity(h.input("B"));
  await h.bootstrapStarted;
  assert.equal(h.identityRecordState(), "bootstrap_pending");
  h.resolveBootstrap(bootstrapResult("actor-b", "token-b"));
  assert.equal(h.identityRecordState(), "pending_activation");
  assert.equal(h.ordinaryClientReadsFor("actor-b"), 0);
  h.resolveActivation();
  await h.rustBeginStarted;
  assert.deepEqual(h.steps.slice(0, 6), [
    "bootstrap_attempt_persisted",
    "bootstrap_resolved_pending",
    "pending_activation_persisted",
    "activation_confirmed",
    "identity_v2_binding_persisted",
    "rust_begin"
  ]);
  assert.equal(h.identityRecordState(), "binding");
  assert.equal(h.identityRecordOrigin(), "issued");
  h.resolveRustBeginPrepared({ identity_generation: 3, status: "bound", actor_id: "actor-b" });
  h.resolvePetAck("prepare", 3);
  h.resolveRustMarkCommitted();
  h.resolvePetAck("commit", 3);
  assert.equal(h.identityRecordState(), "binding");
  assert.equal(h.ordinaryClientReadsFor("actor-b"), 0);
  h.resolveRustFinalize();
  await rebind;
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.identityRecordActor(), "actor-b");
  assert.equal(h.identityRecordHasToken(), true);
});

test("failed B bind cancels the attempt, revokes linked B, and remains signed out", async () => {
  const h = signedOutRebindHarness();
  h.failRustBind(new Error("identity_worker_ack_timeout"));
  await assert.rejects(
    () => rebindDesktopIdentity(h.input("B")),
    (error: unknown) => desktopIdentityReason(error) === "rebind_failed"
  );
  assert.equal(h.cancelAttemptCalls, 1);
  assert.equal(h.linkedActiveDeviceCount, 0);
  assert.equal(h.shellClearCalls, 1);
  assert.equal(h.identityRecordState(), "signed_out");
  assert.equal(h.identityRecordHasToken(), false);
});

for (const failedStage of ["cancel_attempt", "shell_clear", "storage"] as const) {
  test("rollback attempts every stage when " + failedStage + " fails", async () => {
    const h = signedOutRebindHarness();
    h.failRustBind(new Error("pet_identity_ack_timeout"));
    h.failRollbackStage(failedStage);
    await assert.rejects(
      () => rebindDesktopIdentity(h.input("B")),
      (error: unknown) => desktopIdentityReason(error)
        === "rebind_rollback_incomplete"
    );
    assert.equal(h.rollbackCancelAttempts, 1);
    assert.equal(h.rollbackShellClearAttempts, 1);
    assert.equal(h.rollbackStorageAttempts, 1);
    assert.equal(
      h.identityRecordState(),
      failedStage === "cancel_attempt" ? "binding" : "signed_out"
    );
    assert.deepEqual(h.reportedRollbackFailures, [failedStage]);
  });
}

test("rollback attempts every individual storage mutation after one throws", async () => {
  const h = signedOutRebindHarness();
  h.failRustBind(new Error("pet_identity_ack_timeout"));
  h.throwOnStorageMutation("remove_legacy_token");
  await assert.rejects(
    () => rebindDesktopIdentity(h.input("B")),
    (error: unknown) => desktopIdentityReason(error)
      === "rebind_rollback_incomplete"
  );
  assert.deepEqual(h.storageMutationAttempts, [
    "set_identity_v2_signed_out",
    "remove_legacy_token",
    "remove_legacy_token_alias",
    "remove_legacy_actor",
    "remove_legacy_signed_out"
  ]);
  assert.equal(h.identityRecordState(), "signed_out");
});

test("failed canonical signed-out write leaves an interrupted record that boot will not bind", async () => {
  const h = signedOutRebindHarness();
  h.failRustBind(new Error("pet_identity_ack_timeout"));
  h.throwOnStorageMutation("set_identity_v2_signed_out");
  await assert.rejects(
    () => rebindDesktopIdentity(h.input("B")),
    (error: unknown) => desktopIdentityReason(error)
      === "rebind_rollback_incomplete"
  );
  assert.equal(h.identityRecordState(), "binding");
  assert.equal(
    resolveDesktopBootIdentity(await h.privateStore.get()).state,
    "interrupted_binding"
  );
  assert.equal(h.rustRequestsFor("actor-b"), 0);
});

test("lost cancel response probes terminal attempt and safely removes issued quarantine", async () => {
  const h = signedOutRebindHarness();
  h.failRustBind(new Error("pet_identity_ack_timeout"));
  h.cancelAttemptRejects(new Error("response lost"));
  h.attemptProbeResolves({ state: "cancelled" });
  await assert.rejects(
    () => rebindDesktopIdentity(h.input("B")),
    (error: unknown) => desktopIdentityReason(error) === "rebind_failed"
  );
  assert.equal(h.identityRecordState(), "signed_out");
  assert.equal(h.identityRecordHasToken(), false);
});

test("unknown attempt state preserves issued quarantine and disables another rebind", async () => {
  const h = signedOutRebindHarness();
  h.failRustBind(new Error("pet_identity_ack_timeout"));
  h.cancelAttemptRejects(new Error("network down"));
  h.attemptProbeRejects(new Error("probe unavailable"));
  await assert.rejects(
    () => rebindDesktopIdentity(h.input("B")),
    (error: unknown) => desktopIdentityReason(error)
      === "rebind_rollback_incomplete"
  );
  assert.equal(h.identityRecordState(), "binding");
  assert.equal(h.identityRecordOrigin(), "issued");
  assert.equal(h.identityRecordHasToken(), true);
  assert.equal(h.rustRequestsFor("actor-b"), 0);
  assert.equal(h.rebindSubmitDisabled, true);
});
~~~

- [ ] **Step 7: Implement rebind with token-scoped rollback**

Success sequence:

1. Generate a UUID attempt id and 256-bit base64url cancel secret with Web Crypto; await Rust private-store CAS/fsync ack for v2 `bootstrap_pending`. Missing/throwing secure randomness is exactly `bootstrap_attempt_generation_failed`; failed persistence is `local_identity_persist_failed`. Both send **zero** requests.
2. Call `bootstrapDesktop` once with that capability. Timeout/lost response never retries start: probe/cancel the same attempt. The server response is still non-authenticating.
3. Immediately await private-store CAS/fsync ack to `pending_activation` containing exact attempt/secret/actor/device/token/server expiry. If this write fails, do not activate; cancel with the already-durable attempt capability. A force-quit still leaves fsynced `bootstrap_pending`, whose late start is neutralized by cancel tombstone.
4. Call token-scoped `activateDesktopBootstrap`. Lost response probes exact attempt and requires matching actor/device: pending retries the same activate, active continues, cancelled/expired fails safely, unknown preserves `pending_activation` and starts zero Rust/Pet work.
5. After confirmed activation, await private-store CAS to `binding(origin="issued")` while retaining attempt/secret/device metadata. Then run Task 4's Rust/Pet prepare → mark → commit → finalize protocol. The record stays `binding` through finalize.
6. After finalize resolves, await CAS to v2 `bound` and report success. A failed final write starts a fresh clear transition from Stable B, then cancels the attempt so the linked device is revoked.

After any start/activation/transition failure, first settle the correct Rust active-lease/fresh-clear path, then run `compensateFailedRebind`. It never short-circuits:

~~~ts
async function compensateFailedRebind(input: RebindCompensationInput) {
  const cancel = cancelBootstrapAttemptWithProbe(input);
  const shellClear = settle("shell_clear", () =>
    settleOrStartLeasedClear(input)
  );
  const currentRead = settleValue("storage.read_current", () =>
    input.privateStore.get()
  );
  const [cancellation, shell, current] = await Promise.all([
    cancel, shellClear, currentRead
  ]);
  const canonical = !current.ok
    ? current.failure
    : cancellation.safe_terminal
    ? await settle("storage.set_identity_v2_signed_out", async () =>
        input.privateStore.compareAndSwap(
          current.value.revision, { version: 2, state: "signed_out" }
        ))
    : await settle("storage.preserve_recovery_record", async () =>
        assertExactBootstrapRecoveryRecord(current.value, input.recovery));
  const legacy = await Promise.all([
    settle("storage.remove_legacy_token", async () =>
      input.legacyStorage.removeItem(desktopIdentityStorageKeys.legacyToken)),
    settle("storage.remove_legacy_token_alias", async () =>
      input.legacyStorage.removeItem(desktopIdentityStorageKeys.legacyTokenAlias)),
    settle("storage.remove_legacy_actor", async () =>
      input.legacyStorage.removeItem(desktopIdentityStorageKeys.legacyActorId)),
    settle("storage.remove_legacy_signed_out", async () =>
      input.legacyStorage.removeItem(desktopIdentityStorageKeys.legacySignedOut))
  ]);
  const failures = [
    ...(cancellation.safe_terminal ? [] : [cancellation.failure]),
    shell,
    canonical,
    ...legacy
  ].filter(isCompensationFailure);
  if (failures.length) {
    throw new DesktopIdentityError(
      "rebind_rollback_incomplete",
      "issued_identity_cleanup_unknown",
      failures.map(({ stage, reason_code }) => ({ stage, reason_code }))
    );
  }
}
~~~

`cancelBootstrapAttemptWithProbe` uses the anonymous same-base client and the three-second limit. Cancel success, probe `cancelled`, `revoked`, or `expired` is a safe terminal. Probe `pending` retries the same cancel; probe `active` retries cancel because the endpoint must revoke the linked device. Any request/probe failure is `bootstrap_attempt_cleanup_unknown`. Only a safe terminal may replace recovery state with signed-out. Pending/active/unknown verifies and retains the exact `bootstrap_pending`, `pending_activation`, or issued `binding`; it never deletes the only cleanup capability. Ordinary pre-existing identity logout continues to use abortable `revokeCurrentClientDevice` plus `me` probe.

`settle` returns sanitized stage/reason only and never throws. Attempt cancel/probe and Rust/Pet clear may run concurrently only after both inputs are durably recoverable; canonical decision and every legacy removal are attempted after both settle. If signed-out canonical write succeeds, the client is safely signed out even when legacy cleanup remains. Unknown cleanup keeps a recovery-only diagnostic with “Retry cleanup”; nickname/admin-secret inputs and submit are disabled, so another bootstrap cannot begin. There is no in-memory-only credential fallback: before response the durable attempt can tombstone-cancel; after response the durable `pending_activation`/binding contains everything needed to cancel. Complete compensation throws original `rebind_failed`; any incomplete stage throws sanitized `rebind_rollback_incomplete`/`issued_identity_cleanup_unknown` without token or cancel secret.

Add a regression where `privateStore.get()` fails during compensation: cancel, shell clear, read-current, and every legacy cleanup stage are still attempted; the aggregated result contains only `storage.read_current` plus its stable reason. No read failure may short-circuit later cleanup.

- [ ] **Step 8: Run and commit**

~~~bash
pnpm --filter @workhub/desktop-webview exec node --import tsx --test \
  src/desktop-identity.test.ts
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview typecheck
pnpm --filter @workhub/web test
pnpm --filter @workhub/web typecheck
pnpm --filter @workhub/api-client test
pnpm --filter @workhub/api-client typecheck
git diff --check
~~~

~~~bash
git add apps/desktop-webview/src/desktop-identity.ts \
  apps/desktop-webview/src/desktop-identity.test.ts \
  apps/desktop-webview/src/desktop-identity-store.ts \
  apps/desktop-webview/src/desktop-identity-store.test.ts \
  apps/desktop-webview/src/browser.ts \
  apps/desktop-webview/src/spotlight/views/drive.ts \
  apps/desktop-webview/src/spotlight/views/drive.test.ts \
  apps/desktop-webview/src/main.test.ts \
  apps/web/src/main.test.ts \
  packages/api-client/src/client.ts \
  packages/api-client/src/types.ts \
  packages/api-client/src/api-client.test.ts
git commit -m "fix(desktop): orchestrate acknowledged identity changes"
~~~

---

### Task 5: Put signed-out/rebind in the current Spotlight UI

**Files:**
- Create: `apps/desktop-webview/src/desktop-rebind.ts`
- Create: `apps/desktop-webview/src/desktop-rebind.test.ts`
- Create: `apps/desktop-webview/src/spotlight/views/settings.test.ts`
- Modify: `apps/desktop-webview/src/spotlight/views/settings.ts:16-133`
- Modify: `apps/desktop-webview/src/spotlight/view-context.ts`
- Modify: `apps/desktop-webview/src/spotlight/controller.ts`
- Modify: `apps/desktop-webview/src/spotlight/controller.test.ts`
- Modify: `apps/desktop-webview/src/browser.ts:875-1219,1255-1371`
- Modify: `apps/api/src/routes/auth.ts:228-267`
- Modify: `apps/api/src/http-error-codes.ts`
- Modify: `apps/api/src/auth.test.ts:2140-2315`
- Modify: `apps/api/src/openapi.ts:723-731`
- Modify: `apps/api/src/app.test.ts:2516-2533`

**Interfaces:**
- Consumes: Task 4 orchestration/boot union.
- Produces: reachable current Spotlight signed-out view and visible logout/rebind states.

- [ ] **Step 1: Write failing Settings tests**

~~~ts
test("Settings keeps A when server logout fails", async () => {
  const h = settingsLogoutHarness();
  h.logout.reject(new Error("503"));
  h.clickLogout();
  await h.settled();
  assert.equal(h.reloadCalls, 0);
  assert.equal(h.token, "token-a");
  assert.equal(h.buttonDisabled, false);
  assert.match(h.lastToast, /退出失败|Sign out failed/u);
});

test("Settings reloads only after acknowledged logout", async () => {
  const h = settingsLogoutHarness();
  h.clickLogout();
  h.resolveServer();
  assert.equal(h.reloadCalls, 0);
  h.resolveRustAndPet();
  await h.settled();
  assert.equal(h.reloadCalls, 1);
});

test("Settings distinguishes server failure from local cleanup failure", async () => {
  const h = settingsLogoutHarness();
  h.failShellAfterServerLogout();
  h.clickLogout();
  await h.settled();
  assert.equal(h.reloadCalls, 0);
  assert.match(
    h.lastToast,
    /服务端已退出，但本地清理未完成|Server signed out; local cleanup is incomplete/u
  );
});

test("Settings does not claim A is active when logout state is unknown", async () => {
  const h = settingsLogoutHarness();
  h.failLogoutAndProbe();
  h.clickLogout();
  await h.settled();
  assert.equal(h.reloadCalls, 0);
  assert.match(
    h.lastToast,
    /无法确认服务端退出状态|Could not confirm the server sign-out state/u
  );
  assert.doesNotMatch(h.lastToast, /当前身份仍保留|current identity is still active/u);
});
~~~

- [ ] **Step 2: Write failing current-entry rebind tests**

~~~ts
test("signed-out view uses shared Spotlight glass and an explicit form", () => {
  const html = renderDesktopRebind({ locale: "zh-CN", state: "idle" });
  assert.match(html, /data-desktop-rebind/u);
  assert.match(html, /class="wh-spot/u);
  assert.match(html, /aria-live="polite"/u);
  assert.doesNotMatch(html, /style="/u);
});

test("stored actor mismatch renders safe cleanup instead of binding or auto-bootstrap", async () => {
  const h = rebindViewHarness();
  h.bootWithStoredIdentity("actor-a", "token-b");
  h.meResolves("actor-b");
  await h.boot();
  assert.equal(h.rustBindCalls, 0);
  assert.equal(h.bootstrapCalls, 0);
  assert.match(h.root.textContent ?? "", /身份数据不一致|identity data does not match/u);
  assert.equal(h.safeCleanupButton.hidden, false);
  assert.equal(h.retryButton.hidden, false);
});

test("blank nickname stays local and announces the error", async () => {
  const h = rebindViewHarness();
  h.nickname.value = "   ";
  h.clickSubmit();
  await h.settled();
  assert.equal(h.bootstrapCalls, 0);
  assert.match(h.liveRegion.textContent ?? "", /请先填写昵称|enter a nickname/u);
  assert.equal(h.document.activeElement, h.nickname);
});

test("admin nickname asks for the admin secret instead of becoming a generic dead end", async () => {
  const h = rebindViewHarness();
  h.nickname.value = "admin";
  h.bootstrapRejects({ status: 403, code: "admin_secret_required" });
  h.clickSubmit();
  await h.settled();
  assert.equal(h.adminSecret.hidden, false);
  assert.equal(h.document.activeElement, h.adminSecret);
  assert.equal(h.reloadCalls, 0);
});

test("incomplete B cleanup mounts recovery-only UI and blocks another bootstrap", async () => {
  const h = rebindViewHarness();
  h.rebindRejects(identityError(
    "rebind_rollback_incomplete",
    "issued_identity_cleanup_unknown"
  ));
  h.clickSubmit();
  await h.settled();
  assert.equal(h.reloadCalls, 0);
  assert.equal(h.recoveryOnlyViewMounted, true);
  assert.equal(h.nicknameSubmitExists, false);
  assert.equal(h.retryCleanupButton.hidden, false);
  assert.match(
    h.liveRegion.textContent ?? "",
    /清理状态无法确认|cleanup could not be confirmed/u
  );
});
~~~

~~~ts
import { readFileSync } from "node:fs";

test("the current browser entry owns rebind and the legacy boot path is gone", () => {
  const source = readFileSync(new URL("./browser.ts", import.meta.url), "utf8");
  assert.match(source, /bootSpotlight/u);
  assert.match(source, /mountDesktopRebind/u);
  assert.doesNotMatch(source, /async function boot\\(/u);
});
~~~

- [ ] **Step 3: Run focused tests and record RED**

~~~bash
pnpm --filter @workhub/desktop-webview exec node --import tsx --test \
  src/desktop-rebind.test.ts \
  src/spotlight/views/settings.test.ts
~~~

Expected: missing module/tests and swallowed logout produce RED.

- [ ] **Step 4: Implement shared-design rebind**

`renderDesktopRebind` and the identity diagnostic use `renderDesktopSpotlightBootShell`, `wh-spot`, `wh-spot-body`, `wh-spot-act--primary`, shared focus tokens, labelled controls, busy state, and `aria-live`. They contain no inline styles. A valid-token/stored-actor mismatch explains that no identity was activated and offers Retry plus “Safely clear this device”; the latter uses the server-confirmed actor in memory to run the normal acknowledged logout before showing rebind. A network/5xx probe cannot confirm the actor, so it offers Retry and request-id diagnostics only—never local-only deletion disguised as logout.

`mountDesktopRebind` validates trimmed 1-64 character nickname, disables/busy-marks the button, calls Task 4 rebind, reloads only on success, and restores focus/button with stable failure copy on ordinary errors. `issued_identity_cleanup_unknown` does **not** leave an ordinary rebind form: it mounts a recovery-only diagnostic with “Retry cleanup,” keeps nickname/admin-secret submission disabled/absent, and enables rebind only after attempt cancel/probe reaches a safe terminal. It never implies B is active or asks the user to continue in a half-bound state. The ordinary form's optional admin-secret field is initially collapsed. A typed `admin_secret_required` response reveals and focuses it while preserving nickname; retry uses a fresh durably persisted attempt and sends `admin_secret` through the bootstrap request contract.

Give the API response a stable code rather than parsing localized text:

~~~ts
export const desktopAdminSecretRequiredMessage =
  "desktop bootstrap admin secret required";
export const streamMembershipUnavailableMessage =
  "stream workspace membership unavailable";
export const streamWorkspaceMembershipRequiredMessage =
  "stream workspace membership required";
export const workspaceMembershipUnavailableMessage =
  "workspace membership unavailable";

export function httpErrorCodeFor(error: HTTPException) {
  if (error.cause instanceof DesktopBootstrapServiceError) {
    return error.cause.code;
  }
  if (error.status === 403 && error.message === desktopAdminSecretRequiredMessage) {
    return "admin_secret_required";
  }
  if (error.status === 403 && error.message === "invalid client token") {
    return "invalid_client_token";
  }
  if (error.status === 503 && error.message === streamMembershipUnavailableMessage) {
    return "stream_membership_unavailable";
  }
  if (error.status === 503 && error.message === workspaceMembershipUnavailableMessage) {
    return "workspace_membership_unavailable";
  }
  if (error.status === 403 && error.message === streamWorkspaceMembershipRequiredMessage) {
    return "workspace_membership_required";
  }
  if (error.status === 400 && error.message === malformedJsonMessage) {
    return "malformed_json";
  }
  if (error.status === 400 && error.message === jsonObjectMessage) {
    return "json_object_required";
  }
  const codeByStatus: Record<number, string> = {
    400: "bad_request",
    401: "not_identified",
    422: "validation_error",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    429: "rate_limited"
  };
  return codeByStatus[error.status] ?? "http_error";
}
~~~

Use the admin constant in `/desktop-bootstrap` and preserve Task 3 mappings in the same canonical error owner. Exact OpenAPI assertions are: start `403 ["admin_secret_required", "workspace_membership_required"]`, `409 ["bootstrap_attempt_conflict", "bootstrap_attempt_cancelled"]`, `429 ["rate_limited"]`, and `503 ["workspace_membership_unavailable"]`; probe/cancel `403 ["bootstrap_attempt_invalid"]` plus `429 ["rate_limited"]`; activate `403 ["bootstrap_attempt_invalid"]`, `409 ["bootstrap_attempt_cancelled", "bootstrap_attempt_conflict"]`, `410 ["bootstrap_pending_device_expired"]`, and `429 ["rate_limited"]`. Do not overwrite the stream route's separate `stream_membership_unavailable` contract.

- [ ] **Step 5: Replace Settings fire-and-forget logic**

~~~ts
logoutButton.disabled = true;
logoutButton.setAttribute("aria-busy", "true");
ctx.toast(zh ? "正在安全退出…" : "Signing out safely…", "info");
void logoutDesktopIdentity({
  privateStore: ctx.privateIdentityStore,
  legacyStorage: window.localStorage,
  native: resolveDesktopIdentityNativeBridge(),
  createTokenScopedClient: ctx.createTokenScopedClient
})
  .then(() => {
    ctx.toast(zh ? "已安全退出" : "Signed out", "success");
    window.location.reload();
  })
  .catch((error) => {
    const boundary = desktopIdentityBoundaryState(error);
    console.error("workhub_desktop_identity event=logout_failed", {
      reason_code: desktopIdentityReason(error),
      boundary_state: desktopIdentityBoundaryState(error)
    });
    logoutButton.disabled = false;
    logoutButton.removeAttribute("aria-busy");
    ctx.toast(
      boundary === "server_revoked_local_incomplete"
        ? (zh
            ? "服务端已退出，但本地清理未完成；请重启 WorkHub"
            : "Server signed out; local cleanup is incomplete. Restart WorkHub.")
        : boundary === "server_state_unknown"
          ? (zh
              ? "无法确认服务端退出状态；请检查网络后重试"
              : "Could not confirm the server sign-out state. Check the network and retry.")
          : (zh
            ? "退出失败，当前身份仍保留"
            : "Sign out failed; current identity is still active"),
      "error"
    );
  });
~~~

Add required `privateIdentityStore` and `createTokenScopedClient(token)` to `SpotlightViewContext`; the controller/browser wires the Tauri Rust-store adapter (or explicit plain-browser adapter) and the same effective API base/fetch/locale/credentials/error parser as the ordinary client. Settings never passes `ctx.client` and never accepts a separately supplied actor id: logout awaits one canonical private read, derives actor/token atomically, and creates the scoped client from it. `window.localStorage` is passed only as `legacyStorage` for cleanup. Controller tests prove the factory/store are present and configured identically.

- [ ] **Step 6: Make `bootSpotlight()` own signed-out state and delete dead `boot()`**

Before network bootstrap:

~~~ts
const bootIdentity = await resolveDesktopBootIdentityForBoot(
  privateIdentityStore,
  window.localStorage // legacy migration only
);
if (bootIdentity.state === "signed_out") {
  mountDesktopRebind({
    root,
    locale,
    client,
    privateStore: privateIdentityStore,
    legacyStorage: window.localStorage,
    native: resolveDesktopIdentityNativeBridge(),
    reload: () => window.location.reload()
  });
  return;
}
~~~

For an existing token, bounded `client.me()` supplies or verifies actor id before installing identity into Rust/Pet. A stale token transitions to explicit signed-out state; actor mismatch/network failure renders the diagnostic above. None may silently bootstrap fixed nickname `WorkHub Desktop`.

Delete unused legacy `async function boot()` and any helpers made unreferenced.

- [ ] **Step 7: Run Desktop verification and commit**

~~~bash
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview typecheck
pnpm --filter @workhub/desktop-webview build
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="desktop-bootstrap|OpenAPI.*desktop-bootstrap" \
  src/auth.test.ts src/app.test.ts
pnpm --filter @workhub/api typecheck
rg -n '\\.catch\\(\\(\\) => undefined\\)|async function boot\\(' \
  apps/desktop-webview/src/spotlight/views/settings.ts \
  apps/desktop-webview/src/browser.ts
git diff --check
~~~

Expected: test/typecheck/build exit `0`; unsafe/dead search exits `1`.

~~~bash
git add apps/desktop-webview/src/desktop-rebind.ts \
  apps/desktop-webview/src/desktop-rebind.test.ts \
  apps/desktop-webview/src/spotlight/view-context.ts \
  apps/desktop-webview/src/spotlight/controller.ts \
  apps/desktop-webview/src/spotlight/controller.test.ts \
  apps/desktop-webview/src/spotlight/views/settings.ts \
  apps/desktop-webview/src/spotlight/views/settings.test.ts \
  apps/desktop-webview/src/browser.ts \
  apps/api/src/routes/auth.ts \
  apps/api/src/http-error-codes.ts \
  apps/api/src/auth.test.ts \
  apps/api/src/openapi.ts \
  apps/api/src/app.test.ts
git commit -m "fix(desktop): make signed-out rebind reachable"
~~~

---

### Task 6: Bind Cuu streams/cards/restore to actor and generation

**Files:**
- Modify: `apps/desktop-webview/src/desktop-cuu-runtime.ts:538-664,1411-1517` and test
- Modify: `apps/desktop-webview/src/pet-surface.ts:972-1045,2156-2220` and test
- Modify: `apps/desktop-webview/src/shell-events.ts:4-109,258-290` and test
- Modify: `packages/cuu/src/controller.ts` and test
- Modify: `apps/desktop-webview/src/browser.ts:1358-1368`
- Create: `scripts/dev/check-desktop-identity-storage.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 durable-generation payloads and Task 4 phase-specific token-free identity bridge.
- Produces: Pet prepare quiescence plus commit readiness ack/nack, actor-scoped revalidated restore v2, generation-scoped async work, stale-generation rejection, and the repository-wide identity-storage audit after all consumers migrate.

- [ ] **Step 1: Write failing controller reset test**

~~~ts
test("resetIdentityState clears cards, badges, queue, and throttle but keeps preferences", () => {
  const controller = seededCuuController();
  const first = controller.enqueue(bubbleFor("old-1", "work-1"));
  assert.equal(first.reason, "show_now");
  const snapshot = controller.resetIdentityState();
  assert.equal(snapshot.active_card, undefined);
  assert.deepEqual(snapshot.queue, []);
  assert.deepEqual(snapshot.badges, []);
  assert.equal(snapshot.badge_count, 0);
  assert.equal(snapshot.preferences.attention_mode, "quiet");
  const sameThrottleKey = controller.enqueue(bubbleFor("new-1", "work-1"));
  assert.equal(sameThrottleKey.reason, "show_now");
  assert.notEqual(sameThrottleKey.reason, "bubble_throttled");
});
~~~

- [ ] **Step 2: Write failing direct-stream/generation/Pet tests**

~~~ts
test("identity abort closes direct fetch SSE and polling", async () => {
  const identity = new AbortController();
  const h = cuuRunStreamHarness({
    actorId: "actor-a",
    identityGeneration: 1,
    identitySignal: identity.signal
  });
  h.subscribe();
  identity.abort("stream_identity_changed");
  await h.settled();
  assert.equal(h.fetchSignal.aborted, true);
  assert.equal(h.pendingTimers, 0);
  assert.equal(h.lastStatus.reason, "stream_identity_changed");
});

test("shell bridge discards A generation after observing B", () => {
  const events: string[] = [];
  const bridge = bridgeHarness(events);
  bridge.status({ identity_generation: 3, state: "open" });
  bridge.push({ identity_generation: 2, event: "private.a" });
  bridge.push({ identity_generation: 3, event: "private.b" });
  assert.deepEqual(events, ["private.b"]);
});

test("shell bridge rejects stale notification telemetry and never owns activation routing", () => {
  const h = bridgeHarness([]);
  h.advanceIdentityFloor(3);
  assert.equal(h.systemNotification({ identityGeneration: 2, target: "/runs/a" }), undefined);
  assert.equal(h.observeNotificationActivation({ identityGeneration: 2, target: "/runs/a" }), undefined);
  h.observeNotificationActivation({ identityGeneration: 3, target: "/runs/b" });
  h.observeNotificationActivation({ identityGeneration: 3, target: "/runs/b" });
  assert.equal(h.systemNotification({ identityGeneration: 3, target: "/runs/b" })?.target, "/runs/b");
  assert.equal(h.routeActionCalls, 0); // Rust execute_window_control is the only owner
});

test("Pet acks clear only after A private state is gone", async () => {
  const h = petIdentityHarness({ actorId: "actor-a", generation: 1 });
  h.seedRunCardPollingAndRestore();
  await h.receive({
    change_id: "change-2",
    phase: "prepare",
    snapshot: { identity_generation: 2, status: "cleared" }
  });
  assert.equal(h.runStreamClosed, true);
  assert.equal(h.pollingStopped, true);
  assert.equal(h.currentCard, undefined);
  assert.equal(h.restoreFor("actor-a"), undefined);
  assert.deepEqual(h.lastAck, {
    change_id: "change-2",
    surface: "pet",
    identity_generation: 2,
    phase: "prepare",
    ok: true
  });
  await h.receive({
    change_id: "change-2",
    phase: "commit",
    snapshot: { identity_generation: 2, status: "cleared" }
  });
  assert.equal(h.lastAck.phase, "commit");
  assert.equal(h.signedOutNeutralVisible, true);
});

test("duplicate prepare and commit each re-ack without tearing down B twice", async () => {
  const h = petIdentityHarness({ actorId: "actor-a", generation: 1 });
  h.storeIssuedBinding("actor-b", 3, "token-b");
  const prepare = {
    change_id: "change-3",
    phase: "prepare",
    snapshot: { identity_generation: 3, status: "bound", actor_id: "actor-b" }
  } as const;
  await h.receive(prepare);
  await h.receive(prepare);
  assert.equal(h.apiCallsFor("actor-b"), 0);
  const commit = { ...prepare, phase: "commit" as const };
  await h.receive(commit);
  await h.receive(commit);
  assert.equal(h.boundScopeCreateCalls("actor-b"), 1);
  assert.equal(h.acksFor("change-3", "prepare"), 2);
  assert.equal(h.acksFor("change-3", "commit"), 2);
});

test("late duplicate prepare after commit cannot tear down the ready B scope", async () => {
  const h = petIdentityHarness({ actorId: "actor-a", generation: 1 });
  const { prepare, commit } = h.messagesForIssuedBinding("actor-b", 3, "token-b");
  await h.receive(prepare);
  await h.receive(commit);
  await h.receive(prepare);
  assert.equal(h.boundScopeCreateCalls("actor-b"), 1);
  assert.equal(h.boundScopeAbortCalls("actor-b"), 0);
  assert.equal(h.lastAck.phase, "prepare");
});

test("commit without a recorded prepare is rejected and starts no B work", async () => {
  const h = petIdentityHarness({ actorId: "actor-a", generation: 1 });
  h.storeIssuedBinding("actor-b", 3, "token-b");
  await h.receive({
    change_id: "change-3",
    phase: "commit",
    snapshot: { identity_generation: 3, status: "bound", actor_id: "actor-b" }
  });
  assert.equal(h.lastResult.reason_code, "pet_identity_phase_conflict");
  assert.equal(h.apiCallsFor("actor-b"), 0);
});

test("Pet nacks a bound change when stored actor and snapshot actor differ", async () => {
  const h = petIdentityHarness({ actorId: "actor-a", generation: 1 });
  h.storeIdentityRecord(issuedBindingRecord(ACTOR_A_ID, "token-a", bootstrapAttemptMeta()));
  await h.receive({
    change_id: "change-3",
    phase: "prepare",
    snapshot: { identity_generation: 3, status: "bound", actor_id: "actor-b" }
  });
  assert.deepEqual(h.lastResult, {
    change_id: "change-3",
    surface: "pet",
    identity_generation: 3,
    phase: "prepare",
    ok: false,
    reason_code: "pet_identity_actor_mismatch"
  });
  assert.equal(h.apiCallsAfterMessage, 0);
  assert.equal(h.directStreamOpenCallsAfterMessage, 0);
});

for (const delayedOperation of ["restore", "attention", "action", "run_lookup", "retry"] as const) {
  test("delayed A " + delayedOperation + " completion cannot mutate B", async () => {
    const h = petIdentityHarness({ actorId: "actor-a", generation: 1 });
    const delayed = h.deferPrivateOperation(delayedOperation);
    await h.prepareAndCommitActor("actor-b", 3, "token-b");
    delayed.resolve(privateResultFor("actor-a"));
    await h.flush();
    assert.equal(h.visibleCardActorId, undefined);
    assert.equal(h.restoreFor("actor-a"), undefined);
    assert.equal(h.pendingIdentityTimers("actor-a", 1), 0);
    assert.deepEqual(h.systemNotificationsFor("actor-a"), []);
  });
}

test("same-actor restore from an older durable generation is revalidated before render", async () => {
  const h = petIdentityHarness({ actorId: "actor-b", generation: 9 });
  h.storeRestore({
    version: 2,
    actor_id: "actor-b",
    identity_generation: 7,
    entity_type: "session",
    entity_id: "session-b",
    updated_at_ms: 1
  });
  h.deferSession("session-b");
  const restore = h.restore();
  assert.equal(h.visibleCardActorId, undefined);
  h.resolveSession("session-b", sessionFor("actor-b"));
  await restore;
  assert.equal(h.visibleCardActorId, "actor-b");
  assert.equal(h.restoreFor("actor-b")?.identity_generation, 9);
});

test("future-generation restore is deleted without fetch or render", async () => {
  const h = petIdentityHarness({ actorId: "actor-b", generation: 9 });
  h.storeRestore(restoreHint("actor-b", 10, "session-b"));
  await h.restore();
  assert.equal(h.restoreFor("actor-b"), undefined);
  assert.equal(h.privateFetchCalls, 0);
  assert.equal(h.visibleCardActorId, undefined);
  assert.equal(h.lastReasonCode, "identity_generation_conflict");
});
~~~

- [ ] **Step 3: Run focused tests and record RED**

~~~bash
pnpm --filter @workhub/cuu exec node --import tsx --test src/controller.test.ts
pnpm --filter @workhub/desktop-webview exec node --import tsx --test \
  src/desktop-cuu-runtime.test.ts \
  src/pet-surface.test.ts \
  src/shell-events.test.ts
~~~

- [ ] **Step 4: Make direct SSE identity-bound**

Change subscription input to:

~~~ts
identity: {
  actorId: string;
  identityGeneration: number;
  clientToken: string;
  signal: AbortSignal;
};
~~~

Pass token explicitly into fetch SSE; delete localStorage token lookup inside `open()`. Abort calls `close("stream_identity_changed")`. Every event/refresh returns immediately when closed/aborted. Status includes actor/generation, never token.

`bindDesktopShellCuuRuntime` also receives the identity signal and an injected timer registry. Its reconnect delay, attention refresh, notification callback, and queued decision delivery capture the scope; abort clears every owned timeout and suppresses all later callbacks. A retry callback checks scope before opening a stream, not merely when scheduling the timer.

- [ ] **Step 5: Require and enforce generation on shell payloads**

Add `identity_generation` to push/status payloads and require camelCase `identityGeneration` on the existing Tauri system-notification/activation telemetry payload contract. Reject missing, negative, non-integer, or unsafe-integer values. The bridge tracks the greatest durable generation and returns `undefined` for older push, status, system-notification delivery, or activation **observation** before constructing a WorkHub event/card/telemetry record. It never performs a route action; Rust's exactly-once activation sink is the only navigation owner. `DesktopIdentityChangeMessage.snapshot.identity_generation` advances this floor before Pet begins teardown, so callbacks already queued in the JavaScript task queue are stale immediately. The persisted Rust generation counter prevents a restarted process from reusing A's generation.

- [ ] **Step 6: Implement Pet teardown and restore v2**

~~~ts
type DesktopPetRestoreState = {
  version: 2;
  actor_id: string;
  identity_generation: number;
  entity_type: "agent_run" | "session";
  entity_id: string;
  href?: string;
  updated_at_ms: number;
};
~~~

The restore record is only an identity-bound entity hint; it never contains a cached private card. Delete legacy v1 and actor-mismatched records. For the same actor, both matching and older durable generations must re-fetch `getAgentRun` or `getSession` under the current token before rendering; a generation mismatch is logged and the successful record is rewritten to the current generation. Unauthorized/not-found results delete the hint. No cached session card may render before that revalidation.

A restore generation greater than the current durable generation is corrupt/impossible for the same isolated profile: delete it, record `identity_generation_conflict`, and perform zero fetch/render. It may not be normalized downward.

Create one current scope:

~~~ts
type DesktopPetIdentityScope = {
  actorId?: string;
  identityGeneration: number;
  signal: AbortSignal;
};

function isCurrentPetIdentityScope(
  expected: DesktopPetIdentityScope,
  current: DesktopPetIdentityScope
) {
  return expected === current && !expected.signal.aborted;
}
~~~

Every private async entry captures that exact object: restore (`getAgentRun` and `getSession`), initial/visible attention fetch, action submission and its follow-up run lookup, direct-stream callback, route fallback that can render state, and delayed retry. Check `isCurrentPetIdentityScope` after every `await` and immediately before `setCard`, controller enqueue/reset-sensitive callback, restore write/delete, system notification, status mutation, polling start, and timer reschedule. Race long work against `scope.signal`; operations that cannot cancel server work may finish remotely, but their result is observed and discarded without any A-side client mutation. Expected abort logs `stream_identity_changed` at info. Replace the existing bare catches in these paths with structured `pet_identity_operation_failed` or `pet_identity_storage_failed` warnings containing operation, actor id, generation, request id/stable API code, and no private response/card/error text. During the identity barrier, storage failure becomes the `pet_identity_cleanup_failed` nack rather than a warning-only continuation.

Install the identity listener before Pet data loading. A `prepare` message acks only after:

1. advance the shell bridge generation floor to the message generation;
2. abort the current identity scope;
3. close direct stream and await its settled promise;
4. stop polling and clear every identity-owned retry/action/attention/restore timer;
5. reset Cuu controller including throttle/dedupe state;
6. clear current/pending/busy/private render and delete old actor restore;
7. prove no tracked identity operation or timer remains;
8. call Rust `get_pet_private_identity` for the exact requested phase/id/generation, validate its private result against the public snapshot, store a prepared descriptor keyed by exact change id/generation, and prove **zero** target API/SSE/restore/render work has started.

For bound prepare, Rust private state must be `binding` with exact actor/non-empty token; `pending_activation`, `bound`, legacy, malformed, or mismatch nacks. During Committing, the same command permits exact prepare replay for a restarted Pet while still starting zero target work. For clear prepare, no credential is returned. The prepare result is cached per `(change_id,"prepare")` and duplicate delivery only re-emits it.

A `commit` message is accepted only after successful exact prepare in the current Pet process. It calls Rust private read again; bound target still requires exact Committing `binding` (ordinary `bound` is written only after Rust finalize), while clear requires no credential and main's signed-out CAS ack. Then and only then create the new abort controller/scope, install every stale-scope guard/timer registry, schedule B restore/attention/direct SSE or render neutral signed-out state, cache `(change_id,"commit")`, and ack. “Ready” means the local scope and guards are installed; it does not wait for a remote SSE connection. Results are cached by `(change_id, phase)`: duplicate commit re-emits without recreating scope, and a late duplicate prepare after commit re-emits its cached prepare ack without running teardown again. Commit-before-prepare or different snapshot is `pet_identity_phase_conflict` with zero target work. A Pet restart deliberately loses prepared state, forcing main to replay prepare then commit. Clear recovery uses the same two phases and lease rules.

Pet `browser.ts` must not call `ensureDesktopClientToken`, bootstrap, localStorage identity, or mint identity. During a transition it starts target work only after main commit as above. On a cold app start or isolated Pet recreation where public native state is already Stable/Bound, it may call the stable variant of `get_pet_private_identity`; exact actor/generation plus private `bound` are required before creating one scope. Stable/Cleared renders neutral. Tests cover Stable-B Pet recreation and commit-ack→Pet crash→Rust finalize→stable recreation. A lower generation returns `identity_generation_conflict`; it never lowers the floor.

Legacy keys, malformed records, wrong state, or actor mismatch emit phase-specific `pet_identity_actor_mismatch`; cleanup/storage failure emits `pet_identity_cleanup_failed`. Main stops retries and enters leased recovery on any nack. Silence alone is `pet_identity_ack_timeout`. Result payloads always include the exact phase.

After all consumers are migrated, add `audit:desktop-identity-storage` and wire it into root `lint`. `scripts/dev/check-desktop-identity-storage.ts` enumerates real non-test source via `rg --files`; in Tauri production paths it rejects every v2 identity-key localStorage read/write and requires `DesktopIdentityPrivateStoreBridge`. It permits legacy key literals only in the migration/cleanup module and Rust QA initializer, and permits browser v2 only inside the explicitly named non-Tauri adapter. It also rejects `ensureDesktopClientToken`/fixed bootstrap helpers in Browser/Drive/Pet/Cuu and any second token authority. The Rust audit checks private-store commands are surface/phase restricted and their return types are absent from public event payloads. This gate is created here—not Task 4—so it is green at introduction.

- [ ] **Step 7: Run and commit**

~~~bash
pnpm --filter @workhub/cuu test
pnpm --filter @workhub/cuu typecheck
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview typecheck
pnpm qa:cuu-r3-run-stream-smoke
pnpm audit:desktop-identity-storage
git diff --check
~~~

~~~bash
git add packages/cuu/src/controller.ts \
  packages/cuu/src/controller.test.ts \
  apps/desktop-webview/src/browser.ts \
  apps/desktop-webview/src/desktop-cuu-runtime.ts \
  apps/desktop-webview/src/desktop-cuu-runtime.test.ts \
  apps/desktop-webview/src/pet-surface.ts \
  apps/desktop-webview/src/pet-surface.test.ts \
  apps/desktop-webview/src/shell-events.ts \
  apps/desktop-webview/src/shell-events.test.ts \
  scripts/dev/check-desktop-identity-storage.ts \
  package.json
git commit -m "fix(cuu): reset private state on identity change"
~~~

---

### Task 7: Prove A -> logout -> B and record pending-review evidence

**Files:**
- Create: `apps/desktop-webview/src/desktop-identity-boundary.test.ts`
- Create: `apps/desktop-webview/src/desktop-identity-qa.ts`
- Create: `apps/desktop-webview/src/desktop-identity-qa.test.ts`
- Create: `scripts/qa/desktop-identity-boundary-macos.ts`
- Create: `client-tauri/src-tauri/tauri.identity-qa.conf.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `client-tauri/src-tauri/src/main.rs` (debug-only QA orchestration/report seam)
- Modify: `client-tauri/src-tauri/src/config.rs` (QA endpoint/profile proof)
- Modify: `client-tauri/src-tauri/src/identity_store.rs` (debug-only crash failpoints)
- Modify: `client-tauri/src-tauri/src/notification_lifecycle.rs` (debug-only inspection seam)
- Modify: `apps/desktop-webview/src/browser.ts` (debug-only QA entry)
- Modify: `apps/desktop-webview/src/pet-surface.ts` (debug-only QA evidence snapshot)
- Modify: `docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md:17-24`
- Create ignored: `.superpowers/sdd/batch0-desktop-identity-evidence.md`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: deterministic cross-layer acceptance and fresh review package.

- [ ] **Step 1: Write acceptance tests**

~~~ts
test("A logout and B rebind cannot leak A stream, card, notification, or restore", async () => {
  const h = identityBoundaryHarness();
  await h.bindA();
  h.openRustMeForA();
  h.openPetRunForA();
  h.seedRestoreForA();
  await h.logoutA();
  assert.equal(h.serverARevoked, true);
  assert.equal(h.rustAClosedBeforeLogoutResolved, true);
  assert.equal(h.petAClosedBeforeLogoutResolved, true);
  assert.equal(h.restoreFor("actor-a"), undefined);
  assert.equal(h.uiState, "signed_out");

  await h.bindB();
  h.deliverRust({ actorId: "actor-a", generation: 1, type: "private.a" });
  h.deliverNotification({ actorId: "actor-a", generation: 1 });
  h.deliverPet({ actorId: "actor-a", generation: 1 });
  h.deliverRust({ actorId: "actor-b", generation: 3, type: "private.b" });
  assert.deepEqual(h.visiblePrivateEvents, ["private.b"]);
  assert.deepEqual(h.systemNotifications, []);
  assert.equal(h.restoreFor("actor-b")?.actor_id, "actor-b");
});

test("503 device revoke plus same-actor probe keeps A and starts no local transition", async () => {
  const h = identityBoundaryHarness();
  await h.bindA();
  h.failNextDeviceRevoke(503);
  h.resolveIdentityProbe("actor-a");
  await assert.rejects(() => h.logoutA());
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.identityRecordActor(), "actor-a");
  assert.equal(h.identityRecordHasToken(), true);
  assert.equal(h.identityGeneration, 1);
  assert.equal(h.rustAStreamOpen, true);
  assert.equal(h.petAStreamOpen, true);
  assert.equal(h.visibleCardActorId, "actor-a");
  assert.notEqual(h.identityRecordState(), "signed_out");
});

test("device revoke and probe failure preserves local A but reports server state unknown", async () => {
  const h = identityBoundaryHarness();
  await h.bindA();
  h.failNextDeviceRevoke(503);
  h.failIdentityProbe(new Error("network unavailable"));
  await assert.rejects(
    () => h.logoutA(),
    (error: unknown) => desktopIdentityBoundaryState(error) === "server_state_unknown"
  );
  assert.equal(h.identityRecordState(), "bound");
  assert.equal(h.identityRecordHasToken(), true);
  assert.equal(h.localTransitionCalls, 0);
  assert.equal(h.uiState, "identity_unknown");
});

test("A and B each remain non-authenticating until durable pending activation is confirmed", async () => {
  const h = identityBoundaryHarness();
  for (const actor of ["actor-a", "actor-b"] as const) {
    const bind = h.startRebind(actor);
    await h.bootstrapStarted(actor);
    assert.equal(h.canonicalState(), "bootstrap_pending");
    h.resolveBootstrapPending(actor);
    assert.equal(h.canonicalState(), "pending_activation");
    assert.equal(await h.pendingMeStatus(actor), 403);
    assert.equal(await h.pendingStreamConnected(actor), false);
    assert.equal(h.rustOrPetRequests(actor), 0);
    h.resolveActivation(actor);
    await h.resolveTwoPhaseBind(actor);
    await bind;
    assert.equal(h.canonicalState(), "bound");
  }
});
~~~

- [ ] **Step 2: Capture RED then GREEN**

~~~bash
pnpm --filter @workhub/desktop-webview exec node --import tsx --test \
  src/desktop-identity-boundary.test.ts
~~~

Record the pre-glue failing assertion and final exact test/pass/fail counts.

- [ ] **Step 3: Add a current native macOS A -> logout -> restart -> B gate**

Pin root dev dependency `@tauri-apps/cli` to `2.11.4` (compatible with local Tauri 2.11.x), commit `pnpm-lock.yaml`, and have the harness invoke that owned tool with process cwd `client-tauri/src-tauri`: `pnpm exec tauri build --debug --config tauri.identity-qa.conf.json`. (`tauri build` has no `--project-dir` flag.) It checks `pnpm exec tauri --version` first and maps mismatch/missing CLI to a stable QA toolchain reason; it never assumes `cargo-tauri` is globally installed.

`scripts/qa/desktop-identity-boundary-macos.ts` is Darwin-only and fails rather than skips when required native evidence is unavailable. It resolves the Rust toolchain explicitly from `CARGO_HOME`/`~/.cargo/bin`, creates unique PostgreSQL 16/Redis 7 containers and ports, migrates the database, starts the real API on a unique base URL, and builds that packaged debug app. The harness never mints A/B tokens outside the app and never manually seeds membership: the packaged main WebView itself drives the production durable-attempt → pending activation → activate → two-phase bind flow for A and B. The 60-second wall-clock deadline begins after build. Cleanup terminates processes/containers in `finally` and preserves sanitized failure evidence.

The overlay has one fixed non-production TCC identity—`com.mycyg.workhub.identityqa`, product `WorkHub Identity QA`—rather than a per-run bundle id, so notification permission can be granted once. It hard-fails if resolved bundle id equals `com.mycyg.workhub` and requires macOS 14+ for the data-store APIs. macOS WKWebView does not accept an arbitrary data directory: configure fixed QA-only 16-byte data-store UUID `00000000-0000-4000-8000-494451514101`. Set every overlay window `create:false`; Tauri otherwise builds configured windows before user setup and makes the store non-removable. A runner-owned non-secret phase flag distinguishes first `reset`, intermediate `preserve`, and final `cleanup` launches. Only reset setup, on the running main-thread event loop, enumerates/removes exactly the QA store and awaits success **before** manually creating main/Pet with that identifier. Crash/A/B restarts use preserve and assert the same store remains. At scenario end destroy and verify all QA WebViews absent, then a cleanup phase awaits removal of that same store before the outer runner finalizes the report/exits. Report both removal results. Application config artifacts still use the guarded QA root. The harness never reads/deletes production WorkHub paths or notifications.

Debug-only `WORKHUB_IDENTITY_QA_PROFILE_ROOT` redirects and reports every filesystem artifact: explicit `workhub-shell-config.json`, `pet-window-state.json`, durable generation file, crash-durable private identity store, notification migration marker, logs, screenshots/DOM, and report. Do not assume `BaseDirectory::Config` is bundle-specific. Rust refuses startup unless every resolved path is inside the QA root and outside production config/Application Support. Legacy localStorage isolation is proved by the fixed QA data-store identifier, not a fictitious WebKit path. The overlay disables the production `workhub`/`yqgl` deep-link registrations (use no deep-link plugin, or an isolated `workhub-identityqa` scheme) and reports the effective schemes, so QA cannot steal URL-handler ownership. The fixed QA bundle/profile also isolates Notification Center; its one-time broad legacy clear can affect only QA notifications.

Place a no-log in-memory localhost reverse proxy in front of the unique API and inject the proxy base through a debug-only token-free QA config into both the WebView client factory and Rust request planner. The proxy transparently streams SSE and captures only bootstrap request cancel secrets and response tokens in owned process memory for the final leak scan; it never writes them, includes them in errors, or forwards them to the report. After scanning it overwrites owned mutable `Buffer`s and drops references best-effort; the enforceable guarantees are no write/log/report plus recursive leak scan, not impossible zeroization of every runtime string copy. Report both effective client bases and require exact equality with the proxy; any default/production endpoint is a hard failure. Disable production single-instance collision by the distinct bundle id and assert the active process/bundle. `WORKHUB_CUU_QA_CLIENT_TOKEN`, `WORKHUB_CLIENT_TOKEN`, and `YQGL_CLIENT_TOKEN` are unset and forbidden for this gate.

The QA seam is compiled only under Rust `debug_assertions` and enabled only by `WORKHUB_IDENTITY_QA_SCENARIO=a-logout-restart-b`; release builds expose no QA command or hook. Rust injects only a boolean scenario flag and report path, never a token/secret, into main. Main drives production rebind/logout; Pet drives the production phase handler. Test-only hooks snapshot public state, inspect the owned QA notification backend, deliver a generation-tagged fixture, and replay an opaque saved A notification identifier after B to the production Rust activation guard. TypeScript observes activation telemetry only.

Before the A/B journey, run two disposable crash sub-scenarios against the same isolated private store. First, arm a debug failpoint immediately after Rust returns the fsync-backed `pending_activation` CAS ack and call `_exit`; restart must read that exact attempt and cancel it. Second, let the proxy forward activation and observe the server commit while withholding the response, then terminate the app; restart must read `pending_activation`, probe `active`, cancel the linked `client_devices` row, and CAS signed-out. These failpoints never bypass production persistence/probe/cancel code. Only after the store is confirmed signed-out and no disposable active device remains may the A journey start.

The report is written atomically and validates every reason against a closed allowlist on both success and failure; raw exception messages/stacks never enter it. The sole self-referential exception is report temp/write/fsync/rename failure: the app can only emit fixed `identity_qa_report_write_failed` plus target path class to captured stderr and exit nonzero, while the outer runner writes a sanitized failure ledger entry; it does not pretend an app report exists.

~~~ts
type DesktopIdentityQaReasonCode =
  | "notification_permission_missing"
  | "identity_qa_bundle_not_isolated"
  | "identity_qa_profile_not_isolated"
  | "identity_qa_data_store_failed"
  | "identity_qa_deep_link_not_isolated"
  | "identity_qa_api_base_mismatch"
  | "identity_qa_platform_unsupported"
  | "identity_qa_toolchain_failed"
  | "identity_qa_database_failed"
  | "identity_qa_proxy_failed"
  | "identity_qa_process_failed"
  | "identity_qa_notification_inspection_failed"
  | "identity_qa_route_mismatch"
  | "identity_qa_report_write_failed"
  | "identity_qa_secret_leak"
  | "identity_qa_timeout"
  | "identity_qa_artifact_incomplete"
  | "identity_qa_real_stream_missing"
  | "pet_identity_ack_timeout"
  | "system_notification_clear_failed"
  | "stream_auth_revoked";

type DesktopIdentityMacosQaSuccessReport = {
  schema_version: 1;
  platform: "macos";
  implementation_sha: string;
  source_tree_hash: string;
  qa_config_sha256: string;
  clean_worktree: true;
  passed: true;
  isolation: {
    bundle_id: "com.mycyg.workhub.identityqa";
    product_name: "WorkHub Identity QA";
    profile_root: string;
    webview_data_store_identifier: string;
    webview_data_store_removed_before_first_launch: true;
    webview_data_store_removed_after_scenario: true;
    shell_config_path: string;
    pet_window_state_path: string;
    generation_store_path: string;
    private_identity_store_path: string;
    notification_marker_path: string;
    deep_link_schemes: [] | ["workhub-identityqa"];
    webview_api_base: string;
    rust_api_base: string;
    notification_permission: "granted";
    production_paths_touched: 0;
  };
  stages: {
    crash_recovery: {
      pending_activation_persist_ack_then_exit: true;
      restart_recovered_attempt_and_cancelled: true;
      activation_committed_response_withheld_then_exit: true;
      restart_probe_saw_active: true;
      linked_active_device_cancelled: true;
      private_store_terminal_state: "signed_out";
    };
    a_bootstrap: {
      attempt_persisted_before_request: true;
      membership_created_by_start: true;
      pending_activation_persisted: true;
      pending_me_status: 403;
      pending_sse_connected: false;
      rust_pet_requests_before_activation: 0;
      activation_confirmed: true;
    };
    a_bound: { actor_id: string; generation: number; rust_stream_open: true; pet_stream_open: true };
    a_notification: { delivered_count: number; generation: number };
    logout: {
      device_revoked: true;
      rust_registered: number;
      rust_acknowledged: number;
      pet_prepare_acknowledged: true;
      rust_mark_committed: true;
      pet_commit_acknowledged: true;
      rust_finalized: true;
      delivered_notifications_removed: number;
      old_private_operations_remaining: 0;
    };
    restart: {
      state: "signed_out";
      canonical_record_has_token: false;
      legacy_identity_key_count: 0;
      anonymous_requests: 0;
      generation_counter_preserved: true;
      profile_path_unchanged: true;
    };
    b_bootstrap: {
      attempt_persisted_before_request: true;
      pending_activation_persisted: true;
      pending_me_status: 403;
      pending_sse_connected: false;
      activation_confirmed: true;
    };
    b_bound: { actor_id: string; generation: number; rust_stream_open: true; pet_stream_open: true };
    delayed_a: {
      notification_delivery_rejected: true;
      notification_activation_rejected: true;
      old_process_terminated: true;
    };
    b_only: {
      visible_card_actor_id: string;
      restore_actor_id: string;
      same_dedupe_key_notification_visible: true;
      b_activation_guard_replay_opened_exact_route_once: true;
      physical_click: false;
      private_a_artifacts: 0;
    };
  };
  reason_codes: [];
  artifact_paths: string[];
};

type DesktopIdentityQaFailureStage =
  | "preflight"
  | "toolchain"
  | "database"
  | "proxy"
  | "build"
  | "first_launch"
  | "a_bootstrap"
  | "a_bound"
  | "logout"
  | "restart"
  | "b_bootstrap"
  | "b_bound"
  | "notification"
  | "artifact_scan"
  | "cleanup"
  | "report";

type DesktopIdentityMacosQaFailureReport = {
  schema_version: 1;
  platform: "macos" | "other";
  implementation_sha: string;
  source_tree_hash: string;
  qa_config_sha256: string;
  clean_worktree: boolean;
  passed: false;
  failure: {
    stage: DesktopIdentityQaFailureStage;
    reason_code: DesktopIdentityQaReasonCode;
  };
  partial_evidence: Record<string, number | boolean | null>;
  reason_codes: [DesktopIdentityQaReasonCode];
  artifact_paths: string[];
};

type DesktopIdentityMacosQaReport =
  | DesktopIdentityMacosQaSuccessReport
  | DesktopIdentityMacosQaFailureReport;
~~~

For each actor after activation, the harness creates a real workspace-scoped project/task/run fixture through the QA database/service seam (identity/membership still come only from production bootstrap), publishes the normal private run event, and lets the production Pet handler render the card and open its direct run SSE. `pet_stream_open:true` requires server-side presence for that exact run topic plus the Pet's public scope snapshot; a debug hook alone cannot assert it. The delayed-operation unit races remain Task 6 evidence—after native process restart, no real old Rust/Pet task can still execute, so Task 7 reports old-process termination rather than pretending to deliver a physical cross-process callback.

The gate must inspect Notification Center and observe at least one actual A notification before logout, a positive selective removal count before the notification-worker ack, and B delivery with the same logical dedupe key. It replays opaque identifiers directly into the production activation guard to prove stale-A rejection, duplicate-callback exactly-once handling, and one exact-route B guard action; this is explicitly `physical_click:false`, not a human/macOS click claim, so historical P1-11 remains pending its exact-route physical click evidence. It proves `b_bound.generation > a_bound.generation` across restart from the isolated durable counter. Notification permission denial, production bundle/path/scheme detection, endpoint mismatch, inability to inspect/remove only QA notifications, missing either Pet phase ack, no real active stream, route mismatch, or inability to relaunch is a hard failure.

Capture child stdout and stderr separately and enumerate **every** evidence artifact recursively: report JSON, logs, DOM dumps, screenshots, configs, temporary request captures, and ledger. Scan raw bytes for the exact A/B token and cancel-secret fixture values plus URL/base64/JSON-escaped aliases; scan structured text for forbidden field names carrying non-redacted values. Any match fails and reports only artifact path + secret class, never the secret. Logs may say `submitted`, `did_deliver`, `cleared`, or `activation_rejected`; only Notification Center inspection may claim OS visibility. The report records all artifact paths so the scan cannot omit an unlisted side file.

Before producing evidence, run focused QA unit tests, commit all implementation/seam/config files, and require a clean tracked worktree. The report's `implementation_sha`/`source_tree_hash` are calculated from that committed tree, and `qa_config_sha256` hashes the committed overlay; uncommitted implementation is a hard `identity_qa_artifact_incomplete` failure.

~~~bash
pnpm --filter @workhub/desktop-webview exec node --import tsx --test \
  src/desktop-identity-boundary.test.ts src/desktop-identity-qa.test.ts
git add apps/desktop-webview/src/desktop-identity-boundary.test.ts \
  apps/desktop-webview/src/desktop-identity-qa.ts \
  apps/desktop-webview/src/desktop-identity-qa.test.ts \
  apps/desktop-webview/src/browser.ts \
  apps/desktop-webview/src/pet-surface.ts \
  client-tauri/src-tauri/src/main.rs \
  client-tauri/src-tauri/src/config.rs \
  client-tauri/src-tauri/src/identity_store.rs \
  client-tauri/src-tauri/src/notification_lifecycle.rs \
  client-tauri/src-tauri/tauri.identity-qa.conf.json \
  scripts/qa/desktop-identity-boundary-macos.ts \
  package.json \
  pnpm-lock.yaml
git commit -m "test(desktop): add isolated native identity gate"
git status --short
~~~

Expected: focused tests pass, commit succeeds, and tracked status is empty (ignored evidence directory may exist).

- [ ] **Step 4: Run the native gate at the clean implementation SHA**

~~~bash
pnpm qa:desktop-identity-boundary-macos
~~~

Expected: exit `0`, report `passed: true`, `clean_worktree:true`, every boolean/count invariant above satisfied, and exact artifact path recorded in the ignored evidence ledger.

- [ ] **Step 5: Run fresh full affected verification**

~~~bash
pnpm --filter @workhub/api test
pnpm --filter @workhub/api typecheck
pnpm --filter @workhub/api-client test
pnpm --filter @workhub/api-client typecheck
pnpm --filter @workhub/db test
pnpm --filter @workhub/db typecheck
pnpm --filter @workhub/web test
pnpm --filter @workhub/web typecheck
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview typecheck
pnpm --filter @workhub/desktop-webview build
pnpm --filter @workhub/cuu test
pnpm --filter @workhub/cuu typecheck
cargo fmt --manifest-path client-tauri/src-tauri/Cargo.toml -- --check
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml
cargo build --manifest-path client-tauri/src-tauri/Cargo.toml
cargo build --release --manifest-path client-tauri/src-tauri/Cargo.toml
pnpm qa:cuu-r3-run-stream-smoke
pnpm qa:desktop-identity-db-pg
pnpm qa:desktop-identity-boundary-macos
pnpm audit:portable-config
pnpm audit:target-paths
pnpm audit:migrations
pnpm audit:desktop-identity-storage
pnpm verify
git diff --check
~~~

Resolve the release executable from Cargo metadata, run `strings` on it, and require no `WORKHUB_IDENTITY_QA_SCENARIO`, QA-only command name, or report-seam symbol. A compile-contract test also asserts QA command registration is inside `#[cfg(debug_assertions)]`. Record exact counts, exits, durations, and implementation range.

- [ ] **Step 6: Run unsafe-handle audits**

~~~bash
rg -n -e 'set_client_token' -e 'ShellClientToken' \
  -e 'client token received' -e 'catch\\(\\(\\) => undefined\\)' \
  client-tauri/src-tauri/src \
  apps/desktop-webview/src/spotlight/views/settings.ts
rg -n -e 'WORKHUB_CLIENT_TOKEN' -e 'YQGL_CLIENT_TOKEN' \
  scripts/qa/cuu-tauri-linux-smoke.sh \
  scripts/qa/cuu-tauri-motion-capture.ps1
~~~

Expected: both searches exit `1`.

- [ ] **Step 7: Update living audit conservatively**

Add P1-9 `FIXED_PENDING_REVIEW` with exact commits, RED/GREEN evidence, unsafe searches, and explicit statement that report-wide `HOLD` remains. Do not rewrite historical P1-9.

- [ ] **Step 8: Commit the living audit after evidence**

~~~bash
git add docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md
git commit -m "docs(review): record desktop identity boundary evidence"
~~~

---

### Task 8: Independent review and reviewed closeout

**Files:**
- Modify rejected task files only when a reviewer finds an issue.
- Modify after clean review: `docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md`
- Update ignored ledger: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: Task 7 range/evidence.
- Produces: reviewed P1-9 closure or explicit loop back.

- [ ] **Step 1: Review each task**

Provide each reviewer its plan section, base/head range, tests, and changed files. Require Critical/Important/Minor with file/line evidence.

- [ ] **Step 2: Fix Critical and Important**

Return findings to the owning implementer, add focused RED/GREEN regression for behavior changes, commit separately, and re-dispatch the same reviewer. Passing full suites does not waive a finding.

- [ ] **Step 3: Review whole batch**

Trace:

~~~text
A token -> device revoke -> Rust prepare/worker barrier + notification cleanup -> Pet prepare
-> signed-out persistence -> Rust mark -> Pet commit -> Rust finalize
-> signed-out restart
-> B pending activation -> Pet prepare/commit -> durable B generation
-> delayed A delivery/activation rejection -> B-only delivery
~~~

Also inspect config-token conflict, API reauth, cleanup idempotence, logs, and audit wording.

- [ ] **Step 4: Re-run fresh verification at reviewed implementation head**

Repeat Task 7 Steps 4-6, including the clean-SHA native macOS gate, full affected verification, release negative QA-symbol check, and unsafe-handle audits. If a later commit is docs-only, label evidence “reviewed implementation head <sha>”, never “current head”.

- [ ] **Step 5: Mark P1-9 reviewed with HOLD preserved**

Only when Critical/Important are zero and verification is green:

- change P1-9 to `FIXED_REVIEWED`;
- record reviewer counts and implementation SHA;
- preserve historical finding and report-wide `HOLD`;
- state Batch 0 is complete only when P0-1 and P1-9 are both `FIXED_REVIEWED`.

- [ ] **Step 6: Commit**

~~~bash
git add docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md
git commit -m "docs: close Batch 0 desktop identity review"
~~~

---

## Test Helper Contracts

All harnesses are private to their named test file and are not production exports. Names in snippets define required observable controls, not a shared testing API. Implement the smallest harness that proves each assertion with these rules:

- inject clock/timers, logger, storage, API client, notification backend, activation sink, and native bridge rather than patching globals after startup;
- each fake Deferred has `promise`, `resolve(value)`, and `reject(error)`; `completed` in snippets aliases `promise`;
- expose separate counters for attempted, acknowledged, dropped, timed-out, restarted, destroyed, and committed stages—never infer one from another;
- model Rust identity phases (`stable`, `preparing`, `degraded`) and Pet results (ack/nack) explicitly;
- let delayed operation fixtures resolve after an identity change so post-`await` guards are exercised;
- use fake timers or an injected clock for every timeout/retry; focused tests never sleep for the production 2/3/8/10-second limits;
- fake notification delivery distinguishes submitted, did-deliver receipt, visible-center inspection, cleared, and activated;
- fixture tokens are synthetic but still treated as secrets: assertion failures/log snapshots must not serialize them.

## Plan Self-Review Checklist

- [ ] One production token authority, staged generation, Rust active cancellation, notification lifecycle, ack/nack, server reauth, current rebind, Pet direct SSE, actor restore, stale rejection, and A -> B each map to a task.
- [ ] Server failure/unknown, already-absent, lease/worker/Pet timeout, storage/rollback, repository/auth timeout, notification receipt/clear, config conflict, and overflow have stable reasons.
- [ ] No target Rust private side effect, local signed-in success, or user-facing success precedes server/Rust/Pet/storage confirmation.
- [ ] No token material appears in payloads, logs, evidence, notification identifiers, or reports.
- [ ] No anonymous or staged-token Rust/Cuu retry loop runs while cleared/preparing/degraded.
- [ ] Connected, heartbeat, and bus event after revocation are dropped before output with sequential bounded checks.
- [ ] Restore cannot cross actor, render cached private cards, or consume legacy v1 without deletion.
- [ ] Current `bootSpotlight()` owns migration/rebind and dead `boot()` is removed.
- [ ] Native packaged-macOS evidence covers stream, Pet, Notification Center clear, stale activation, signed-out restart, and B exact-route activation.
- [ ] Every task has RED, GREEN, exact files, a commit, and independent review.
- [ ] Audit history and report-wide `HOLD` stay intact.

## Execution

Execute via subagent-driven development in this session: one fresh implementer per task, independent task review after each, and a separate whole-batch reviewer. The user requested an autonomous repair-review loop, so no additional execution-choice prompt is required unless a new product decision changes this identity contract.
