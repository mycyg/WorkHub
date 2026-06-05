#[derive(Debug, Clone, PartialEq, Eq)]
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
}

pub fn normalize_server_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}
