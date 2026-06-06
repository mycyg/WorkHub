use serde::{Deserialize, Serialize};

pub const WORKHUB_SERVER_URL_ENV: &str = "WORKHUB_SERVER_URL";
pub const WORKHUB_CLIENT_TOKEN_ENV: &str = "WORKHUB_CLIENT_TOKEN";
pub const LEGACY_CLIENT_TOKEN_ENV: &str = "YQGL_CLIENT_TOKEN";
pub const WORKHUB_DEVICE_NAME_ENV: &str = "WORKHUB_DEVICE_NAME";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkHubShellConfig {
    pub server_url: String,
    pub client_token: Option<String>,
    pub device_name: String,
}

impl WorkHubShellConfig {
    pub fn lan_default() -> Self {
        Self {
            server_url: "http://127.0.0.1:8787".to_string(),
            client_token: None,
            device_name: "WorkHub desktop".to_string(),
        }
    }

    pub fn has_trusted_device_token(&self) -> bool {
        self.client_token
            .as_ref()
            .map(|token| !token.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn client_token_tail(&self) -> Option<String> {
        let token = self.client_token.as_ref()?.trim();
        if token.is_empty() {
            return None;
        }
        let tail_len = token.chars().count().min(4);
        Some(
            token
                .chars()
                .skip(token.chars().count() - tail_len)
                .collect(),
        )
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkHubShellConfigFile {
    pub server_url: Option<String>,
    pub client_token: Option<String>,
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkHubShellConfigLoadError {
    InvalidJson(String),
}

pub fn normalize_server_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

pub fn load_shell_config_from_json_and_env<F>(
    raw_json: Option<&str>,
    env_value: F,
) -> Result<WorkHubShellConfig, WorkHubShellConfigLoadError>
where
    F: Fn(&str) -> Option<String>,
{
    let from_file = match raw_json {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str::<WorkHubShellConfigFile>(raw)
            .map_err(|error| WorkHubShellConfigLoadError::InvalidJson(error.to_string()))?,
        _ => WorkHubShellConfigFile::default(),
    };

    let mut config = WorkHubShellConfig::lan_default();
    if let Some(server_url) = clean_optional(from_file.server_url) {
        config.server_url = server_url;
    }
    if let Some(device_name) = clean_optional(from_file.device_name) {
        config.device_name = device_name;
    }
    config.client_token = clean_optional(from_file.client_token);

    if let Some(server_url) = clean_optional(env_value(WORKHUB_SERVER_URL_ENV)) {
        config.server_url = server_url;
    }
    if let Some(device_name) = clean_optional(env_value(WORKHUB_DEVICE_NAME_ENV)) {
        config.device_name = device_name;
    }
    if let Some(token) = clean_optional(env_value(WORKHUB_CLIENT_TOKEN_ENV))
        .or_else(|| clean_optional(env_value(LEGACY_CLIENT_TOKEN_ENV)))
    {
        config.client_token = Some(token);
    }

    config.server_url = normalize_server_url(&config.server_url);
    Ok(config)
}

fn clean_optional(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_urls_for_daemon_requests() {
        assert_eq!(
            normalize_server_url("  http://127.0.0.1:8787/// "),
            "http://127.0.0.1:8787"
        );
    }

    #[test]
    fn exposes_only_a_safe_device_token_tail() {
        let config = WorkHubShellConfig {
            server_url: "http://127.0.0.1:8787".to_string(),
            client_token: Some("WH-8J7Q-2K9M-4L3P".to_string()),
            device_name: "desktop".to_string(),
        };

        assert_eq!(config.has_trusted_device_token(), true);
        assert_eq!(config.client_token_tail(), Some("4L3P".to_string()));
    }

    #[test]
    fn loads_shell_config_from_file_and_normalizes_empty_fields() {
        let config = load_shell_config_from_json_and_env(
            Some(
                r#"{
                  "server_url": " http://192.168.5.53:8787/// ",
                  "client_token": " ",
                  "device_name": " Linux desk "
                }"#,
            ),
            |_| None,
        )
        .unwrap();

        assert_eq!(config.server_url, "http://192.168.5.53:8787");
        assert_eq!(config.device_name, "Linux desk");
        assert_eq!(config.client_token, None);
    }

    #[test]
    fn env_overrides_file_config_and_supports_legacy_token_name() {
        let config = load_shell_config_from_json_and_env(
            Some(
                r#"{
                  "server_url": "http://127.0.0.1:8787",
                  "client_token": "file-token",
                  "device_name": "file device"
                }"#,
            ),
            |name| match name {
                WORKHUB_SERVER_URL_ENV => Some(" http://10.0.0.2:8787/ ".to_string()),
                WORKHUB_DEVICE_NAME_ENV => Some("env device".to_string()),
                LEGACY_CLIENT_TOKEN_ENV => Some("legacy-token".to_string()),
                _ => None,
            },
        )
        .unwrap();

        assert_eq!(config.server_url, "http://10.0.0.2:8787");
        assert_eq!(config.device_name, "env device");
        assert_eq!(config.client_token, Some("legacy-token".to_string()));
    }

    #[test]
    fn workhub_token_env_takes_priority_over_legacy_token_env() {
        let config = load_shell_config_from_json_and_env(None, |name| match name {
            WORKHUB_CLIENT_TOKEN_ENV => Some("workhub-token".to_string()),
            LEGACY_CLIENT_TOKEN_ENV => Some("legacy-token".to_string()),
            _ => None,
        })
        .unwrap();

        assert_eq!(config.client_token, Some("workhub-token".to_string()));
    }

    #[test]
    fn rejects_invalid_shell_config_json() {
        assert!(matches!(
            load_shell_config_from_json_and_env(Some("{not json"), |_| None),
            Err(WorkHubShellConfigLoadError::InvalidJson(_))
        ));
    }
}
