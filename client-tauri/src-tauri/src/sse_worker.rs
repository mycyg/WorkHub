use futures_util::StreamExt;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
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
    ShellSsePlanError, ShellSseSubscription, ShellSseWorkerPlan,
};

pub const DEFAULT_SSE_RECONNECT_DELAY_MS: u64 = 5_000;

pub fn spawn_default_shell_sse_workers(
    app: tauri::AppHandle,
    config: WorkHubShellConfig,
) -> Result<ShellSseWorkerPlan, ShellSsePlanError> {
    let locale = config.locale;
    spawn_shell_sse_workers(
        app,
        plan_shell_sse_worker(
            &config,
            startup_shell_sse_targets(&config),
            DEFAULT_SSE_RECONNECT_DELAY_MS,
        )?,
        locale,
    )
}

pub fn spawn_shell_sse_workers(
    app: tauri::AppHandle,
    plan: ShellSseWorkerPlan,
    locale: WorkHubLocale,
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
                locale,
            )
            .await;
        });
    }
    Ok(plan)
}

async fn run_sse_subscription(
    app: tauri::AppHandle,
    client: reqwest::Client,
    subscription: ShellSseSubscription,
    reconnect_delay_ms: u64,
    notification_deduper: Arc<Mutex<ShellSystemNotificationDeduper>>,
    locale: WorkHubLocale,
) {
    let delay = Duration::from_millis(reconnect_delay_ms);
    loop {
        emit_sse_status(
            &app,
            &subscription,
            ShellSseConnectionState::Connecting,
            None,
        );

        match open_sse_response(&client, &subscription).await {
            Ok(response) => {
                emit_sse_status(&app, &subscription, ShellSseConnectionState::Open, None);
                if let Err(message) =
                    pump_sse_response(&app, &subscription, response, &notification_deduper, locale)
                        .await
                {
                    emit_sse_status(
                        &app,
                        &subscription,
                        ShellSseConnectionState::Retrying,
                        Some(message),
                    );
                }
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

        sleep(delay).await;
    }
}

async fn open_sse_response(
    client: &reqwest::Client,
    subscription: &ShellSseSubscription,
) -> Result<reqwest::Response, String> {
    let mut request = client
        .get(&subscription.url)
        .header(reqwest::header::ACCEPT, "text/event-stream");
    for header in &subscription.headers {
        request = request.header(&header.name, &header.value);
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
    locale: WorkHubLocale,
) -> Result<(), String> {
    let mut buffer = ShellSseFrameBuffer::default();
    // Buffer raw bytes, not decoded strings: a single TCP chunk can split a
    // multibyte UTF-8 sequence (e.g. CJK) across its boundary, so decoding each
    // chunk individually would corrupt it. We only decode the bytes that belong
    // to complete SSE frames — delimited by the ASCII `\n\n` byte sequence — and
    // hand those decoded frames to the existing frame buffer, which preserves
    // the `\r\n` normalization and event/data semantics.
    let mut pending = Vec::<u8>::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("SSE stream read failed: {error}"))?;
        pending.extend_from_slice(&chunk);

        // Neither `\n` (0x0A) nor `\r` (0x0D) ever appears inside a multibyte
        // UTF-8 sequence (lead/continuation bytes are all >= 0x80), so splitting
        // on the SSE blank-line frame boundary at the byte level can never
        // bisect a character. We forward each complete frame (separator
        // included) to the existing buffer, which keeps the `\r\n`/`\r`
        // normalization and event/data parsing.
        let mut frames = Vec::new();
        while let Some(end) = find_frame_boundary_end(&pending) {
            let frame_bytes: Vec<u8> = pending.drain(..end).collect();
            let frame_text = String::from_utf8_lossy(&frame_bytes);
            frames.extend(buffer.push_chunk(&frame_text));
        }

        for frame in frames {
            let payload = push_payload_from_frame(subscription, frame);
            app.emit(&subscription.event_channel, payload.clone())
                .map_err(|error| format!("failed to emit push-event: {error}"))?;
            if let Some(plan) =
                system_notification_plan_from_push_payload_for_locale(&payload, locale)
                    .map_err(|error| format!("failed to plan system notification: {error:?}"))?
            {
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
    }

    Err("SSE stream ended".to_string())
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
    use crate::sse::ParsedSseFrame;

    #[test]
    fn default_reconnect_delay_is_small_enough_for_desktop_feedback() {
        assert_eq!(DEFAULT_SSE_RECONNECT_DELAY_MS, 5_000);
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
