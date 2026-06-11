use serde::{Deserialize, Serialize};

use crate::config::{normalize_server_url, WorkHubShellConfig};

pub const WORKHUB_CLIENT_TOKEN_HEADER: &str = "X-WorkHub-Client-Token";
pub const LEGACY_CLIENT_TOKEN_HEADER: &str = "X-YQGL-Client-Token";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellRequestPlan {
    pub url: String,
    pub headers: Vec<ShellHeader>,
}

pub fn daemon_url(config: &WorkHubShellConfig, path: &str) -> String {
    let base = normalize_server_url(&config.server_url);
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("{base}{normalized_path}")
}

pub fn plan_daemon_request(config: &WorkHubShellConfig, path: &str) -> ShellRequestPlan {
    let mut headers = Vec::new();
    if let Some(token) = &config.client_token {
        headers.push(ShellHeader {
            name: WORKHUB_CLIENT_TOKEN_HEADER.to_string(),
            value: token.clone(),
        });
        headers.push(ShellHeader {
            name: LEGACY_CLIENT_TOKEN_HEADER.to_string(),
            value: token.clone(),
        });
    }
    ShellRequestPlan {
        url: daemon_url(config, path),
        headers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_request_plan_prefixes_base_url_and_injects_device_token_headers() {
        let config = WorkHubShellConfig {
            server_url: " http://127.0.0.1:8787/ ".to_string(),
            client_token: Some("token-1".to_string()),
            device_name: "desktop".to_string(),
            locale: crate::locale::WorkHubLocale::EnUs,
        };

        let plan = plan_daemon_request(&config, "api/health");

        assert_eq!(plan.url, "http://127.0.0.1:8787/api/health");
        assert_eq!(
            plan.headers
                .iter()
                .map(|header| header.name.as_str())
                .collect::<Vec<_>>(),
            vec![WORKHUB_CLIENT_TOKEN_HEADER, LEGACY_CLIENT_TOKEN_HEADER]
        );
    }
}
