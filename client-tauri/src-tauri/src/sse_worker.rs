use futures_util::StreamExt;
use tauri::Emitter;
use tokio::time::{sleep, Duration};

use crate::config::WorkHubShellConfig;
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
    for subscription in plan.subscriptions.clone() {
        let app = app.clone();
        let client = client.clone();
        let reconnect_delay_ms = plan.reconnect_delay_ms;
        tauri::async_runtime::spawn(async move {
            run_sse_subscription(app, client, subscription, reconnect_delay_ms).await;
        });
    }
    Ok(plan)
}

async fn run_sse_subscription(
    app: tauri::AppHandle,
    client: reqwest::Client,
    subscription: ShellSseSubscription,
    reconnect_delay_ms: u64,
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
                if let Err(message) = pump_sse_response(&app, &subscription, response).await {
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
) -> Result<(), String> {
    let mut buffer = ShellSseFrameBuffer::default();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("SSE stream read failed: {error}"))?;
        let text = String::from_utf8_lossy(&chunk);
        for frame in buffer.push_chunk(&text) {
            let payload = push_payload_from_frame(subscription, frame);
            app.emit(&subscription.event_channel, payload)
                .map_err(|error| format!("failed to emit push-event: {error}"))?;
        }
    }

    Err("SSE stream ended".to_string())
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

    #[test]
    fn default_reconnect_delay_is_small_enough_for_desktop_feedback() {
        assert_eq!(DEFAULT_SSE_RECONNECT_DELAY_MS, 5_000);
    }
}
