use serde::{Deserialize, Serialize};

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

pub fn normalize_server_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
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
}
