use futures_util::StreamExt;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tokio::time::{sleep, Duration};

use crate::config::WorkHubShellConfig;
use crate::locale::WorkHubLocale;
use crate::notify::{
    show_system_notification, system_notification_event_channel,
    system_notification_plan_from_push_payload_for_locale, ShellSystemNotificationDeduper,
    ShellSystemNotificationPlan,
};
use crate::sse::{
    plan_shell_sse_worker, push_payload_from_frame, startup_shell_sse_targets,
    status_event_channel, status_payload, ShellSseConnectionState, ShellSseFrameBuffer,
    ShellSsePlanError, ShellSseSubscription, ShellSseWorkerPlan, MAX_SSE_PENDING_BYTES,
};

pub const DEFAULT_SSE_RECONNECT_DELAY_MS: u64 = 5_000;

/// 共享给 SSE worker 的运行时客户端令牌 + 身份代际。webview 首启 bootstrap 拿到设备令牌后经
/// `set_client_token` 命令写入；worker 每次(重)连前重读它注入鉴权头——故令牌在启动后才到达也能被下一拍
/// 重连用上。config 文件/env 通常无 token。
///
/// SEC P0-02（退出/换号后旧账号私有 SSE 继续 pump）：仅"令牌值"不足以让活跃连接感知身份变更——旧令牌
/// 的 `/stream/me` 在 pump 期间一直灌到 TCP 偶然断。故引入**身份代际** `generation`：每次 `set`（写入或
/// 清空）都递增它并 `notify_waiters()`。worker 的 pump 循环 `select!` 监听通知，并按代际比对——发现代际变化
/// 立即中止当前连接（旧身份连接不再复用）；清空后无令牌则挂起等待，换新令牌则以新身份重连。
/// 清空路径同样递增代际 + 通知（旧实现只写 None 后直接 return、连通知都不发，这正是本缺陷根因）。
#[derive(Default)]
pub struct ShellClientToken {
    slot: Mutex<ClientTokenSlot>,
    notify: Arc<tokio::sync::Notify>,
}

/// 令牌槽：当前令牌 + 单调递增的身份代际。代际每次 `set` 递增，是判断"当前连接身份是否已被顶替"的唯一真相
/// （通知只是唤醒提示，正确性来自代际比对，故 `set` 里先在锁内提交代际、释放锁后再 `notify_waiters`）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ClientTokenSlot {
    token: Option<String>,
    generation: u64,
}

/// 令牌快照：pump 开流时取一次（token + 代际），期间靠代际比对判断身份是否已被顶替。纯数据，便于单测。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClientTokenSnapshot {
    pub token: Option<String>,
    pub generation: u64,
}

impl ShellClientToken {
    /// 写入令牌（`None`/空串路径由调用方归一为 `None` 表示清空）。无论写入还是清空，都递增身份代际并唤醒
    /// 等待者——**清空同样通知**是 SEC P0-02 的关键：退出/换号后挂起中的 worker 靠它醒来（重连/挂起），
    /// 活跃 pump 靠它醒来比对代际并中止旧身份连接。返回写入后的代际，便于诊断/测试。
    pub fn set(&self, token: Option<String>) -> u64 {
        let generation = {
            let mut slot = self
                .slot
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            slot.token = token;
            slot.generation = slot.generation.wrapping_add(1);
            slot.generation
        };
        // 先在锁内提交代际、出锁后再通知：任何在通知后读代际的观察者都能看到新值（通知仅作唤醒，代际才是真相）。
        self.notify.notify_waiters();
        generation
    }

    /// 读取当前令牌快照（token + 代际）。
    pub fn snapshot(&self) -> ClientTokenSnapshot {
        let slot = self
            .slot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ClientTokenSnapshot {
            token: slot.token.clone(),
            generation: slot.generation,
        }
    }

    /// 令牌变更通知句柄（`Arc<Notify>`）。worker 克隆它，pump/退避里 `select!` 监听。
    pub fn change_notifier(&self) -> Arc<tokio::sync::Notify> {
        Arc::clone(&self.notify)
    }
}

/// pump 期间比对代际后的裁决：代际变了→当前连接身份已过期，中止；没变→虚假唤醒/无关通知，继续 pump。纯函数便于单测。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenPumpDecision {
    Continue,
    Superseded,
}

fn decide_token_pump(open_generation: u64, current_generation: u64) -> TokenPumpDecision {
    if current_generation == open_generation {
        TokenPumpDecision::Continue
    } else {
        TokenPumpDecision::Superseded
    }
}

/// 每次(重)连前根据当前令牌快照决定动作：有运行时令牌→带它开流；无令牌但订阅头里已烘焙鉴权（config 令牌）
/// →仍用烘焙头开流；两者皆无→挂起等令牌到达（不再对必鉴权的私有流裸连 401 死锤）。纯函数便于单测。
#[derive(Debug, Clone, PartialEq, Eq)]
enum SseConnectAction {
    Suspend,
    Connect(Option<String>),
}

fn decide_sse_connect(runtime_token: Option<&str>, has_baked_auth: bool) -> SseConnectAction {
    match runtime_token {
        Some(token) => SseConnectAction::Connect(Some(token.to_string())),
        None if has_baked_auth => SseConnectAction::Connect(None),
        None => SseConnectAction::Suspend,
    }
}

/// pump 正常退出原因：目前只有"身份代际被顶替"这一种 Ok 退出（其余流结束/读错误走 `Err`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PumpOutcome {
    Superseded,
}

/// 订阅头里是否已带 client-token 鉴权（来自 config.client_token）。用于无运行时令牌时决定挂起 vs 用烘焙头连。
fn subscription_has_baked_auth(subscription: &ShellSseSubscription) -> bool {
    subscription.headers.iter().any(|header| {
        header
            .name
            .eq_ignore_ascii_case(crate::http::WORKHUB_CLIENT_TOKEN_HEADER)
            || header
                .name
                .eq_ignore_ascii_case(crate::http::LEGACY_CLIENT_TOKEN_HEADER)
    })
}

fn read_token_snapshot(app: &tauri::AppHandle) -> ClientTokenSnapshot {
    app.try_state::<ShellClientToken>()
        .map(|state| state.snapshot())
        .unwrap_or_default()
}

fn token_change_notifier(app: &tauri::AppHandle) -> Option<Arc<tokio::sync::Notify>> {
    app.try_state::<ShellClientToken>()
        .map(|state| state.change_notifier())
}

pub fn spawn_default_shell_sse_workers(
    app: tauri::AppHandle,
    config: WorkHubShellConfig,
) -> Result<ShellSseWorkerPlan, ShellSsePlanError> {
    spawn_shell_sse_workers(
        app,
        plan_shell_sse_worker(
            &config,
            startup_shell_sse_targets(&config),
            DEFAULT_SSE_RECONNECT_DELAY_MS,
        )?,
    )
}

pub fn spawn_shell_sse_workers(
    app: tauri::AppHandle,
    plan: ShellSseWorkerPlan,
) -> Result<ShellSseWorkerPlan, ShellSsePlanError> {
    let client = reqwest::Client::new();
    let notification_deduper = Arc::new(Mutex::new(ShellSystemNotificationDeduper::default()));
    for subscription in plan.subscriptions.clone() {
        let app = app.clone();
        let client = client.clone();
        let notification_deduper = Arc::clone(&notification_deduper);
        let reconnect_delay_ms = plan.reconnect_delay_ms;
        tauri::async_runtime::spawn(async move {
            run_sse_subscription(
                app,
                client,
                subscription,
                reconnect_delay_ms,
                notification_deduper,
            )
            .await;
        });
    }
    Ok(plan)
}

/// R19-13：通知文案的 locale 源。壳层 locale 过去在 worker 启动时按值冻结,应用内切语言后新弹的通知仍是旧
/// 语言。改为每次构建通知计划时**实时**读共享的 `Mutex<WorkHubLocale>`（`set_shell_locale` 命令会更新它）。
/// 拿不到 state（降级/测试无 App）时回退默认语言。纯读,不碰令牌/身份代际逻辑。
fn current_shell_locale(app: &tauri::AppHandle) -> WorkHubLocale {
    app.try_state::<Mutex<WorkHubLocale>>()
        .and_then(|state| state.lock().ok().map(|locale| *locale))
        .unwrap_or_default()
}

async fn run_sse_subscription(
    app: tauri::AppHandle,
    client: reqwest::Client,
    subscription: ShellSseSubscription,
    reconnect_delay_ms: u64,
    notification_deduper: Arc<Mutex<ShellSystemNotificationDeduper>>,
) {
    // rank9：连不上(尤令牌被吊销/后端不可达)时不再固定 5s 死锤服务端——指数退避(上限 60s)；
    // 一旦成功打开连接就把退避复位回基准，故瞬时掉线仍是快速 5s 重连。每拍重读令牌，webview 重铸后即恢复。
    let has_baked_auth = subscription_has_baked_auth(&subscription);
    let mut consecutive_failures: u32 = 0;
    loop {
        // 每次(重)连前重读共享令牌快照：启动时通常没有，webview bootstrap 后写入→下一拍重连即带上→200。
        // 携带代际：pump 期间靠它判断身份是否已被顶替（退出/换号）。
        let snapshot = read_token_snapshot(&app);
        match decide_sse_connect(snapshot.token.as_deref(), has_baked_auth) {
            SseConnectAction::Suspend => {
                // SEC P0-02：无运行时令牌且订阅头无烘焙鉴权——私有 `/stream/me` 裸连必 401。改为挂起等令牌到达
                // （set_client_token 写入即 notify_waiters 唤醒），而不是每拍拿旧/空身份死锤。退出后即停在这里，
                // 不再有任何旧身份连接尝试。
                emit_sse_status(
                    &app,
                    &subscription,
                    ShellSseConnectionState::Retrying,
                    Some("waiting for a client token".to_string()),
                );
                match token_change_notifier(&app) {
                    // 令牌写入用 notify_waiters()（不预存许可，见 `ShellClientToken::set`）：上面读快照与这里
                    // 注册等待者之间到达的写入会被丢弃，裸 `notified().await` 就永久卡死。对齐下方退避分支的
                    // 模式——`select!` 同时等通知与一个基准退避的兜底 sleep，醒来后 continue 重新探测令牌
                    // 快照；正确性来自"每拍重读快照 + 代际比对"（见文件顶部注释），通知/sleep 都只是唤醒提示。
                    // select 竞态窗口本身难以单测钉死，靠兜底轮询保证有界等待。
                    Some(notify) => {
                        tokio::select! {
                            _ = notify.notified() => {}
                            _ = sleep(reconnect_backoff(reconnect_delay_ms, 0)) => {}
                        }
                    }
                    // 拿不到通知句柄（降级）：退回按基准退避轮询，不至于永久卡死。
                    None => sleep(reconnect_backoff(reconnect_delay_ms, 0)).await,
                }
                consecutive_failures = 0;
                continue;
            }
            SseConnectAction::Connect(token) => {
                emit_sse_status(
                    &app,
                    &subscription,
                    ShellSseConnectionState::Connecting,
                    None,
                );
                match open_sse_response(&client, &subscription, token.as_deref()).await {
                    Ok(response) => {
                        emit_sse_status(&app, &subscription, ShellSseConnectionState::Open, None);
                        // 成功打开连接 → 退避复位（连上之后即便流随后中断，也按基准快速重连）。
                        consecutive_failures = 0;
                        match pump_sse_response(
                            &app,
                            &subscription,
                            response,
                            &notification_deduper,
                            snapshot.generation,
                        )
                        .await
                        {
                            Ok(PumpOutcome::Superseded) => {
                                // SEC P0-02：令牌代际变更(退出/换号)→主动中止了旧身份连接。立即以最新快照重连
                                // （新令牌→新身份；已清空→上面的 Suspend 分支挂起），不进退避、不当失败计数。
                                emit_sse_status(
                                    &app,
                                    &subscription,
                                    ShellSseConnectionState::Retrying,
                                    Some("client token changed; reconnecting".to_string()),
                                );
                                continue;
                            }
                            Err(message) => {
                                emit_sse_status(
                                    &app,
                                    &subscription,
                                    ShellSseConnectionState::Retrying,
                                    Some(message),
                                );
                            }
                        }
                    }
                    Err(message) => {
                        consecutive_failures = consecutive_failures.saturating_add(1);
                        emit_sse_status(
                            &app,
                            &subscription,
                            ShellSseConnectionState::Retrying,
                            Some(message),
                        );
                    }
                }
            }
        }

        // RUST-1：退避等待期间监听令牌变更——webview bootstrap 写入新令牌后立刻醒来重连并复位退避，
        // 不再「令牌已就绪却干等满一个退避周期(最长 ~60s)」。克隆 Arc<Notify> 拿到 owned 句柄，避免跨 await 借用 State。
        let delay = reconnect_backoff(reconnect_delay_ms, consecutive_failures);
        match token_change_notifier(&app) {
            Some(notify) => {
                tokio::select! {
                    _ = sleep(delay) => {}
                    _ = notify.notified() => { consecutive_failures = 0; }
                }
            }
            None => sleep(delay).await,
        }
    }
}

// 指数退避：0 次连续失败=基准；每多一次翻倍，封顶 60s。纯函数，便于单测。
fn reconnect_backoff(base_ms: u64, consecutive_failures: u32) -> Duration {
    const MAX_DELAY_MS: u64 = 60_000;
    if consecutive_failures == 0 {
        return Duration::from_millis(base_ms.min(MAX_DELAY_MS));
    }
    let factor = 1u64.checked_shl(consecutive_failures.min(4)).unwrap_or(16);
    Duration::from_millis(base_ms.saturating_mul(factor).min(MAX_DELAY_MS))
}

async fn open_sse_response(
    client: &reqwest::Client,
    subscription: &ShellSseSubscription,
    token: Option<&str>,
) -> Result<reqwest::Response, String> {
    let mut request = client
        .get(&subscription.url)
        .header(reqwest::header::ACCEPT, "text/event-stream");
    for header in &subscription.headers {
        request = request.header(&header.name, &header.value);
    }
    // 注入运行时设备令牌（webview bootstrap 后经 set_client_token 写入）。config 文件/env 通常无 token，
    // 故 subscription.headers 不含鉴权头→裸连 401；带上即 200，Cuu 上线。
    if let Some(token) = token {
        request = request
            .header(crate::http::WORKHUB_CLIENT_TOKEN_HEADER, token)
            .header(crate::http::LEGACY_CLIENT_TOKEN_HEADER, token);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("failed to connect SSE stream: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("SSE stream returned HTTP {status}"));
    }

    Ok(response)
}

async fn pump_sse_response(
    app: &tauri::AppHandle,
    subscription: &ShellSseSubscription,
    response: reqwest::Response,
    notification_deduper: &Arc<Mutex<ShellSystemNotificationDeduper>>,
    open_generation: u64,
) -> Result<PumpOutcome, String> {
    let mut buffer = ShellSseFrameBuffer::default();
    // Buffer raw bytes, not decoded strings: a single TCP chunk can split a
    // multibyte UTF-8 sequence (e.g. CJK) across its boundary, so decoding each
    // chunk individually would corrupt it. We only decode the bytes that belong
    // to complete SSE frames — delimited by the ASCII `\n\n` byte sequence — and
    // hand those decoded frames to the existing frame buffer, which preserves
    // the `\r\n` normalization and event/data semantics.
    let mut pending = Vec::<u8>::new();
    let mut stream = response.bytes_stream();

    // SEC P0-02：pump 不再只干等 `stream.next()`。旧账号的 `/stream/me` 会一直灌到 TCP 偶然断——退出/换号
    // 后必须"立刻"感知身份变更并中止本连接。故 `select!` 同时监听：响应块读取 vs 令牌变更通知。每轮循环顶
    // 先按代际比对（`decide_token_pump`）——代际变了即中止（Superseded），把连接让给最新身份。代际是唯一真相
    // （通知只是唤醒 idle pump 的提示），故即便通知有极小竞态窗口漏掉，下一块/下一拍的代际比对仍能兜住。
    match token_change_notifier(app) {
        Some(notify) => {
            let notified = notify.notified();
            tokio::pin!(notified);
            loop {
                if decide_token_pump(open_generation, read_token_snapshot(app).generation)
                    == TokenPumpDecision::Superseded
                {
                    return Ok(PumpOutcome::Superseded);
                }
                tokio::select! {
                    biased;
                    _ = &mut notified => {
                        // 令牌变更（写入/清空）唤醒了本连接——重新武装通知，回到循环顶由代际比对裁决
                        // （变更→中止；虚假唤醒→继续）。
                        notified.set(notify.notified());
                    }
                    maybe_chunk = stream.next() => {
                        let Some(chunk) = maybe_chunk else {
                            return Err("SSE stream ended".to_string());
                        };
                        process_sse_chunk(
                            app,
                            subscription,
                            &mut buffer,
                            &mut pending,
                            chunk,
                            notification_deduper,
                        )?;
                    }
                }
            }
        }
        // 拿不到通知句柄（降级/测试）：退回纯 chunk 循环，但每块仍比对代际——活跃流照样能中止，只是 idle 流
        // 要等下一块才感知（生产路径恒能拿到句柄，走上面的 select! 分支）。
        None => {
            while let Some(chunk) = stream.next().await {
                if decide_token_pump(open_generation, read_token_snapshot(app).generation)
                    == TokenPumpDecision::Superseded
                {
                    return Ok(PumpOutcome::Superseded);
                }
                process_sse_chunk(
                    app,
                    subscription,
                    &mut buffer,
                    &mut pending,
                    chunk,
                    notification_deduper,
                )?;
            }
            Err("SSE stream ended".to_string())
        }
    }
}

/// 处理一块 SSE 字节：拼进 pending、切出完整帧、发 push-event / 系统通知。从 pump 循环抽出，让 select! 分支
/// 与降级分支共用同一份逻辑（避免两处漂移）。泛型 `AsRef<[u8]>` 免去具名 reqwest 的 `Bytes` 类型。
fn process_sse_chunk<B: AsRef<[u8]>>(
    app: &tauri::AppHandle,
    subscription: &ShellSseSubscription,
    buffer: &mut ShellSseFrameBuffer,
    pending: &mut Vec<u8>,
    chunk: Result<B, reqwest::Error>,
    notification_deduper: &Arc<Mutex<ShellSystemNotificationDeduper>>,
) -> Result<(), String> {
    let chunk = chunk.map_err(|error| format!("SSE stream read failed: {error}"))?;
    pending.extend_from_slice(chunk.as_ref());

    // Neither `\n` (0x0A) nor `\r` (0x0D) ever appears inside a multibyte
    // UTF-8 sequence (lead/continuation bytes are all >= 0x80), so splitting
    // on the SSE blank-line frame boundary at the byte level can never
    // bisect a character. We forward each complete frame (separator
    // included) to the existing buffer, which keeps the `\r\n`/`\r`
    // normalization and event/data parsing.
    let mut frames = Vec::new();
    while let Some(end) = find_frame_boundary_end(pending) {
        let frame_bytes: Vec<u8> = pending.drain(..end).collect();
        let frame_text = String::from_utf8_lossy(&frame_bytes);
        frames.extend(buffer.push_chunk(&frame_text));
    }
    // R4 #29：排空完整帧后，pending 只剩未终止残片。若它超过上限仍无帧边界（畸形/滥用流，或服务器
    // 一直不发 `\n\n`），继续累积会内存耗尽且每 chunk 的 find_frame_boundary_end 退化成 O(n^2)。
    // 视为协议违例、断开连接（上层会重连，得到干净的帧对齐），而非静默截断破坏后续分帧。
    if pending.len() > MAX_SSE_PENDING_BYTES {
        return Err(format!(
            "SSE frame exceeded {MAX_SSE_PENDING_BYTES}-byte buffer cap without a frame boundary; dropping connection"
        ));
    }

    for frame in frames {
        let payload = push_payload_from_frame(subscription, frame);
        app.emit(&subscription.event_channel, payload.clone())
            .map_err(|error| format!("failed to emit push-event: {error}"))?;
        // R19-13：实时读取当前壳层 locale（而非 worker 启动时的冻结值）——应用内切语言后新弹的通知即刻跟随。
        // 单条通知计划失败（如畸形通知 ID）只跳过这条系统通知，不 `?` 上抛——push-event 已照常 emit，
        // 一条脏数据不该把整条 SSE 连接打断重连（路由侧的畸形 ID 已在 route_for_notification 内优雅降级）。
        let plan = match system_notification_plan_from_push_payload_for_locale(
            &payload,
            current_shell_locale(app),
        ) {
            Ok(plan) => plan,
            Err(error) => {
                eprintln!("failed to plan WorkHub system notification: {error:?}");
                continue;
            }
        };
        if let Some(plan) = plan {
            if !should_deliver_system_notification(notification_deduper, &plan)? {
                continue;
            }
            app.emit(system_notification_event_channel(), plan.clone())
                .map_err(|error| format!("failed to emit system notification: {error}"))?;
            if let Err(error) = show_system_notification(app, &plan) {
                eprintln!("failed to show WorkHub system notification: {error}");
            }
        }
    }

    Ok(())
}

/// Returns the exclusive end index (one past the last separator byte) of the
/// first complete SSE frame in `bytes`, or `None` if no blank-line separator
/// has arrived yet. SSE separates events with a blank line, which may be encoded
/// as `\n\n`, `\r\n\r\n`, or `\r\r`; we recognize all three so that frames flush
/// regardless of the daemon's line endings.
fn find_frame_boundary_end(bytes: &[u8]) -> Option<usize> {
    let mut best: Option<usize> = None;
    let mut consider = |end: Option<usize>| {
        if let Some(end) = end {
            best = Some(match best {
                Some(current) => current.min(end),
                None => end,
            });
        }
    };

    consider(find_subsequence(bytes, b"\r\n\r\n").map(|index| index + 4));
    consider(find_subsequence(bytes, b"\n\n").map(|index| index + 2));
    consider(find_subsequence(bytes, b"\r\r").map(|index| index + 2));
    best
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn should_deliver_system_notification(
    notification_deduper: &Arc<Mutex<ShellSystemNotificationDeduper>>,
    plan: &ShellSystemNotificationPlan,
) -> Result<bool, String> {
    notification_deduper
        .lock()
        .map_err(|_| "system notification dedupe state is poisoned".to_string())
        .map(|mut deduper| deduper.should_deliver(plan))
}

fn emit_sse_status(
    app: &tauri::AppHandle,
    subscription: &ShellSseSubscription,
    state: ShellSseConnectionState,
    message: Option<String>,
) {
    let _ = app.emit(
        status_event_channel(),
        status_payload(subscription, state, message),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::{ShellHeader, LEGACY_CLIENT_TOKEN_HEADER, WORKHUB_CLIENT_TOKEN_HEADER};
    use crate::sse::ParsedSseFrame;

    fn subscription_with_headers(headers: Vec<ShellHeader>) -> ShellSseSubscription {
        ShellSseSubscription {
            kind: "me".to_string(),
            path: "/api/push/stream/me".to_string(),
            url: "http://127.0.0.1:8787/api/push/stream/me".to_string(),
            headers,
            event_channel: "push-event".to_string(),
        }
    }

    // SEC P0-02：写入与清空都必须递增身份代际——清空过去只写 None 后直接 return（连代际都不动、通知都不发），
    // 于是活跃 pump 感知不到退出、旧账号私有流一直灌。这里钉死"清空也递增代际"这一根因修复。
    #[test]
    fn set_and_clear_both_bump_the_identity_generation() {
        let state = ShellClientToken::default();
        assert_eq!(
            state.snapshot(),
            ClientTokenSnapshot {
                token: None,
                generation: 0
            }
        );

        assert_eq!(state.set(Some("token-a".to_string())), 1);
        assert_eq!(
            state.snapshot(),
            ClientTokenSnapshot {
                token: Some("token-a".to_string()),
                generation: 1
            }
        );

        // 换号：新令牌递增代际——旧身份连接据此中止。
        assert_eq!(state.set(Some("token-b".to_string())), 2);
        assert_eq!(state.snapshot().token.as_deref(), Some("token-b"));
        assert_eq!(state.snapshot().generation, 2);

        // 退出：清空同样递增代际（根因修复），且令牌确实清空。
        assert_eq!(state.set(None), 3);
        assert_eq!(
            state.snapshot(),
            ClientTokenSnapshot {
                token: None,
                generation: 3
            }
        );
    }

    // pump 的 select! 分支裁决：代际相等=虚假唤醒/无关通知→继续；代际不同（清空或换号）→中止当前连接。
    #[test]
    fn token_pump_decision_aborts_only_when_the_generation_changed() {
        assert_eq!(decide_token_pump(1, 1), TokenPumpDecision::Continue);
        // 清空(1→2)与换号(1→3 等)都令代际不同 → 立即中止旧身份连接。
        assert_eq!(decide_token_pump(1, 2), TokenPumpDecision::Superseded);
        assert_eq!(decide_token_pump(5, 9), TokenPumpDecision::Superseded);
    }

    // 重连动作裁决：有令牌→带令牌连；无令牌但订阅头已烘焙 config 令牌→用烘焙头连；两者皆无→挂起等令牌
    // （退出清空后即停在此，不再对私有流裸连 401 死锤）。
    #[test]
    fn connect_decision_suspends_without_a_token_unless_auth_is_baked_in() {
        assert_eq!(
            decide_sse_connect(Some("token-a"), false),
            SseConnectAction::Connect(Some("token-a".to_string()))
        );
        assert_eq!(
            decide_sse_connect(Some("token-a"), true),
            SseConnectAction::Connect(Some("token-a".to_string()))
        );
        assert_eq!(decide_sse_connect(None, false), SseConnectAction::Suspend);
        assert_eq!(
            decide_sse_connect(None, true),
            SseConnectAction::Connect(None)
        );
    }

    #[test]
    fn baked_auth_detects_config_client_token_headers_only() {
        assert!(!subscription_has_baked_auth(&subscription_with_headers(
            vec![]
        )));
        assert!(!subscription_has_baked_auth(&subscription_with_headers(
            vec![ShellHeader {
                name: "Accept".to_string(),
                value: "text/event-stream".to_string(),
            }]
        )));
        assert!(subscription_has_baked_auth(&subscription_with_headers(
            vec![ShellHeader {
                name: WORKHUB_CLIENT_TOKEN_HEADER.to_string(),
                value: "config-token".to_string(),
            }]
        )));
        assert!(subscription_has_baked_auth(&subscription_with_headers(
            vec![ShellHeader {
                name: LEGACY_CLIENT_TOKEN_HEADER.to_string(),
                value: "config-token".to_string(),
            }]
        )));
    }

    #[test]
    fn default_reconnect_delay_is_small_enough_for_desktop_feedback() {
        assert_eq!(DEFAULT_SSE_RECONNECT_DELAY_MS, 5_000);
    }

    #[test]
    fn reconnect_backoff_is_base_when_healthy_and_caps_at_60s() {
        // rank9：连上(0 连续失败)=基准；逐次翻倍；封顶 60s，不再固定 5s 死锤吊销 token。
        assert_eq!(reconnect_backoff(5_000, 0), Duration::from_millis(5_000));
        assert_eq!(reconnect_backoff(5_000, 1), Duration::from_millis(10_000));
        assert_eq!(reconnect_backoff(5_000, 2), Duration::from_millis(20_000));
        assert_eq!(reconnect_backoff(5_000, 3), Duration::from_millis(40_000));
        // 5_000*16=80_000 → 封顶 60_000；更多次连续失败仍封顶，不溢出。
        assert_eq!(reconnect_backoff(5_000, 4), Duration::from_millis(60_000));
        assert_eq!(reconnect_backoff(5_000, 99), Duration::from_millis(60_000));
    }

    #[test]
    fn frame_boundary_end_recognizes_every_blank_line_encoding() {
        assert_eq!(find_frame_boundary_end(b"event: x\n"), None);
        assert_eq!(find_frame_boundary_end(b"data: a\n\nrest"), Some(9));
        assert_eq!(find_frame_boundary_end(b"data: a\r\n\r\nrest"), Some(11));
        assert_eq!(find_frame_boundary_end(b"data: a\r\rrest"), Some(9));
    }

    // Drives the exact byte-pump logic from `pump_sse_response`: bytes are
    // buffered, complete frames are sliced off the `\n\n` boundary, and only
    // those complete frames are decoded. This is the regression for a multibyte
    // UTF-8 sequence (here the CJK 你好) split across two network chunks.
    fn pump_bytes(chunks: &[&[u8]]) -> Vec<ParsedSseFrame> {
        let mut buffer = ShellSseFrameBuffer::default();
        let mut pending = Vec::<u8>::new();
        let mut frames = Vec::new();
        for chunk in chunks {
            pending.extend_from_slice(chunk);
            while let Some(end) = find_frame_boundary_end(&pending) {
                let frame_bytes: Vec<u8> = pending.drain(..end).collect();
                let frame_text = String::from_utf8_lossy(&frame_bytes);
                frames.extend(buffer.push_chunk(&frame_text));
            }
        }
        frames
    }

    #[test]
    fn byte_pump_preserves_multibyte_utf8_split_across_chunks() {
        // "你好" is 6 UTF-8 bytes: E4 BD A0 E5 A5 BD. Split the second
        // character across the chunk boundary; per-chunk String decoding would
        // have corrupted it into replacement characters.
        let full = "event: notification.created\ndata: {\"text\":\"你好\"}\n\n";
        let bytes = full.as_bytes();
        let split = bytes.iter().position(|&b| b == 0xE5).unwrap() + 1;
        let frames = pump_bytes(&[&bytes[..split], &bytes[split..]]);

        assert_eq!(
            frames,
            vec![ParsedSseFrame {
                event: "notification.created".to_string(),
                data: "{\"text\":\"你好\"}".to_string(),
            }]
        );
    }

    #[test]
    fn byte_pump_holds_partial_frames_until_the_blank_line_arrives() {
        assert!(pump_bytes(&[b"event: x\n"]).is_empty());
        assert_eq!(
            pump_bytes(&[b"event: x\n", b"data: 1\n\n"]),
            vec![ParsedSseFrame {
                event: "x".to_string(),
                data: "1".to_string(),
            }]
        );
    }
}
