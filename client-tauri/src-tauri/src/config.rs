use serde::{Deserialize, Serialize};
use url::Url;

use crate::locale::{normalize_workhub_locale, WorkHubLocale, WORKHUB_LOCALE_ENV};

pub const WORKHUB_SERVER_URL_ENV: &str = "WORKHUB_SERVER_URL";
pub const WORKHUB_CLIENT_TOKEN_ENV: &str = "WORKHUB_CLIENT_TOKEN";
pub const LEGACY_CLIENT_TOKEN_ENV: &str = "YQGL_CLIENT_TOKEN";
pub const WORKHUB_DEVICE_NAME_ENV: &str = "WORKHUB_DEVICE_NAME";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkHubShellConfig {
    pub server_url: String,
    pub client_token: Option<String>,
    pub device_name: String,
    pub locale: WorkHubLocale,
}

impl WorkHubShellConfig {
    pub fn lan_default() -> Self {
        Self {
            server_url: "http://127.0.0.1:8787".to_string(),
            client_token: None,
            device_name: "WorkHub desktop".to_string(),
            locale: WorkHubLocale::default(),
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
    pub locale: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkHubShellConfigLoadError {
    InvalidJson(String),
}

pub fn normalize_server_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

/// `set_server_url` 命令拒绝一个地址的原因。
///
/// 壳层过去对 `server_url` 只做 `normalize_server_url`（trim + 去尾斜杠），因为它唯一的来源是运维手写的
/// 配置文件/环境变量。S5 之后它变成**由 webview 传进来的用户输入**，就必须和 webview 那道闸同口径校验
/// （见 `normalize_shell_server_url`）。webview 侧非法值静默按「未配置」回落默认，壳层这边是显式命令，
/// 得回一句人能读懂的话，否则用户只会看到一个没有解释的失败。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellServerUrlError {
    Empty,
    Malformed,
    UnsupportedScheme(String),
    HasCredentials,
    HasQueryOrFragment,
}

impl std::fmt::Display for ShellServerUrlError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(formatter, "server address is empty"),
            Self::Malformed => write!(
                formatter,
                "server address must be an absolute URL such as http://192.168.1.10:8787"
            ),
            Self::UnsupportedScheme(scheme) => write!(
                formatter,
                "server address scheme \"{scheme}\" is not supported; use http or https"
            ),
            Self::HasCredentials => write!(
                formatter,
                "server address must not embed a username or password"
            ),
            Self::HasQueryOrFragment => write!(
                formatter,
                "server address must not carry a query string or fragment"
            ),
        }
    }
}

/// 归一化 + 校验壳层服务器地址，返回 `origin + path`（末尾斜杠已去）。
///
/// **逐条对齐 webview 的 `normalizeDesktopApiBase`**（`apps/desktop-webview/src/desktop-api-base.ts:18-38`）：
/// 只收 http/https 绝对地址，拒空/畸形/带凭据/带查询串或 hash。两端必须对同一个输入给出**同一个字符串**
/// ——壳层和 webview 各存一份地址正是 S1 报告 E-06 那条缺陷，口径再分叉一次只会让它以更隐蔽的形式回来。
///
/// 与 JS 的两处对齐细节：`Url::parse` 已把 scheme 小写化（故 `HTTPS://` 与 `https://` 同判）；只有 `?`/`#`
/// 而无内容时 JS 的 `url.search`/`url.hash` 取到空串（falsy，放行），故这里也只拒非空的 query/fragment。
pub fn normalize_shell_server_url(input: &str) -> Result<String, ShellServerUrlError> {
    let value = input.trim();
    if value.is_empty() {
        return Err(ShellServerUrlError::Empty);
    }
    let url = Url::parse(value).map_err(|_| ShellServerUrlError::Malformed)?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ShellServerUrlError::UnsupportedScheme(
            url.scheme().to_string(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ShellServerUrlError::HasCredentials);
    }
    if url.query().is_some_and(|query| !query.is_empty())
        || url.fragment().is_some_and(|fragment| !fragment.is_empty())
    {
        return Err(ShellServerUrlError::HasQueryOrFragment);
    }
    let origin = url.origin().ascii_serialization();
    let path = url.path().trim_end_matches('/');
    Ok(format!("{origin}{path}"))
}

/// 生成写回 `workhub-shell-config.json` 的新内容（纯函数；落盘在 main.rs，这里只算字符串便于单测）。
///
/// 两条刻意的行为：
/// 1. **按 key 打补丁而不是结构体整份重序列化**——文件是用户/运维可手改的，反序列化成
///    `WorkHubShellConfigFile` 再写回会把它不认识的字段悄悄抹掉。
/// 2. **一并删掉 `client_token`**：换服务器等于换身份域，A 服务器铸的设备令牌对 B 毫无意义。留着它，
///    下次启动 `plan_daemon_request` 会把旧令牌烘焙进新服务器的 SSE 鉴权头——拿 A 的凭据去敲 B。
pub fn shell_config_json_with_server_url(
    raw: Option<&str>,
    server_url: &str,
) -> Result<String, WorkHubShellConfigLoadError> {
    let mut document = match raw {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str::<serde_json::Value>(raw)
            .map_err(|error| WorkHubShellConfigLoadError::InvalidJson(error.to_string()))?,
        _ => serde_json::Value::Object(serde_json::Map::new()),
    };
    let object = document.as_object_mut().ok_or_else(|| {
        WorkHubShellConfigLoadError::InvalidJson("shell config root must be a JSON object".into())
    })?;
    object.insert(
        "server_url".to_string(),
        serde_json::Value::String(server_url.to_string()),
    );
    object.remove("client_token");

    serde_json::to_string_pretty(&document)
        .map_err(|error| WorkHubShellConfigLoadError::InvalidJson(error.to_string()))
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
    if let Some(locale) = clean_optional(from_file.locale) {
        config.locale = normalize_workhub_locale(&locale);
    }
    config.client_token = clean_optional(from_file.client_token);

    if let Some(server_url) = clean_optional(env_value(WORKHUB_SERVER_URL_ENV)) {
        config.server_url = server_url;
    }
    if let Some(device_name) = clean_optional(env_value(WORKHUB_DEVICE_NAME_ENV)) {
        config.device_name = device_name;
    }
    if let Some(locale) = clean_optional(env_value(WORKHUB_LOCALE_ENV)) {
        config.locale = normalize_workhub_locale(&locale);
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
            locale: WorkHubLocale::EnUs,
        };

        assert!(config.has_trusted_device_token());
        assert_eq!(config.client_token_tail(), Some("4L3P".to_string()));
    }

    #[test]
    fn loads_shell_config_from_file_and_normalizes_empty_fields() {
        let config = load_shell_config_from_json_and_env(
            Some(
                r#"{
                  "server_url": " http://192.168.5.53:8787/// ",
                  "client_token": " ",
                  "device_name": " Linux desk ",
                  "locale": "en-SG"
                }"#,
            ),
            |_| None,
        )
        .unwrap();

        assert_eq!(config.server_url, "http://192.168.5.53:8787");
        assert_eq!(config.device_name, "Linux desk");
        assert_eq!(config.locale, WorkHubLocale::EnUs);
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
                WORKHUB_LOCALE_ENV => Some("zh-Hans".to_string()),
                LEGACY_CLIENT_TOKEN_ENV => Some("legacy-token".to_string()),
                _ => None,
            },
        )
        .unwrap();

        assert_eq!(config.server_url, "http://10.0.0.2:8787");
        assert_eq!(config.device_name, "env device");
        assert_eq!(config.locale, WorkHubLocale::ZhCn);
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

    // S5：与 webview 的 normalizeDesktopApiBase 同口径。合法输入必须归一成 origin+path、去尾斜杠。
    #[test]
    fn shell_server_url_normalizes_trailing_slashes_and_keeps_the_base_path() {
        assert_eq!(
            normalize_shell_server_url("  http://192.168.1.10:8787///  "),
            Ok("http://192.168.1.10:8787".to_string())
        );
        assert_eq!(
            normalize_shell_server_url("https://workhub.example.com"),
            Ok("https://workhub.example.com".to_string())
        );
        // 反代挂在子路径下是自托管的常见形态，路径要保留（只去末尾斜杠）。
        assert_eq!(
            normalize_shell_server_url("https://example.com/workhub/"),
            Ok("https://example.com/workhub".to_string())
        );
        // 默认端口按 URL 规范折叠掉——JS 的 url.origin 也这么做，两端才能得到同一个字符串。
        assert_eq!(
            normalize_shell_server_url("https://example.com:443/"),
            Ok("https://example.com".to_string())
        );
    }

    // scheme 大小写：Url::parse 与 JS 的 new URL 都把 scheme 小写化，故大写写法同样合法且归一化为小写。
    #[test]
    fn shell_server_url_accepts_uppercase_schemes_and_lowercases_them() {
        assert_eq!(
            normalize_shell_server_url("HTTP://127.0.0.1:8787"),
            Ok("http://127.0.0.1:8787".to_string())
        );
        assert_eq!(
            normalize_shell_server_url("HttpS://Example.COM"),
            Ok("https://example.com".to_string())
        );
    }

    #[test]
    fn shell_server_url_rejects_everything_that_is_not_a_bare_http_base() {
        assert_eq!(normalize_shell_server_url("   "), Err(ShellServerUrlError::Empty));
        // 没有 scheme 的裸主机端口：JS 的 new URL 同样抛（"127.0.0.1" 不是合法 scheme）。
        assert_eq!(
            normalize_shell_server_url("127.0.0.1:8787"),
            Err(ShellServerUrlError::Malformed)
        );
        assert_eq!(
            normalize_shell_server_url("not a url"),
            Err(ShellServerUrlError::Malformed)
        );
        assert_eq!(
            normalize_shell_server_url("javascript:alert(1)"),
            Err(ShellServerUrlError::UnsupportedScheme("javascript".to_string()))
        );
        assert_eq!(
            normalize_shell_server_url("file:///etc/passwd"),
            Err(ShellServerUrlError::UnsupportedScheme("file".to_string()))
        );
        assert_eq!(
            normalize_shell_server_url("ws://127.0.0.1:8787"),
            Err(ShellServerUrlError::UnsupportedScheme("ws".to_string()))
        );
        assert_eq!(
            normalize_shell_server_url("http://user:pass@example.com"),
            Err(ShellServerUrlError::HasCredentials)
        );
        assert_eq!(
            normalize_shell_server_url("http://:pass@example.com"),
            Err(ShellServerUrlError::HasCredentials)
        );
        assert_eq!(
            normalize_shell_server_url("http://example.com/?token=leak"),
            Err(ShellServerUrlError::HasQueryOrFragment)
        );
        assert_eq!(
            normalize_shell_server_url("http://example.com/#/settings"),
            Err(ShellServerUrlError::HasQueryOrFragment)
        );
        // 每条拒绝都得有话可说——命令把它原样回给 webview 当诊断。
        assert!(ShellServerUrlError::Empty.to_string().contains("empty"));
        assert!(ShellServerUrlError::UnsupportedScheme("ws".to_string())
            .to_string()
            .contains("ws"));
    }

    // 落盘：只改 server_url、删掉 client_token，其余字段（含文件里我们不认识的键）原样保留。
    #[test]
    fn writing_a_new_server_url_drops_the_stale_device_token_and_keeps_other_fields() {
        let raw = r#"{
          "server_url": "http://127.0.0.1:8787",
          "client_token": "token-of-the-old-server",
          "device_name": "Ada 的 Mac",
          "locale": "zh-CN",
          "hand_written_note": "keep me"
        }"#;

        let next = shell_config_json_with_server_url(Some(raw), "https://workhub.example.com")
            .expect("rewrite should succeed");
        let document: serde_json::Value = serde_json::from_str(&next).unwrap();

        assert_eq!(document["server_url"], "https://workhub.example.com");
        assert!(
            document.get("client_token").is_none(),
            "换服务器必须丢掉旧服务器的设备令牌，否则重启后它会被烘焙进新服务器的鉴权头"
        );
        assert_eq!(document["device_name"], "Ada 的 Mac");
        assert_eq!(document["hand_written_note"], "keep me");
    }

    // 重读：写出来的文件必须能被启动路径原样读回（落盘 → 重读闭环）。
    #[test]
    fn the_written_shell_config_reloads_into_the_new_server_url() {
        let raw = r#"{"server_url":"http://127.0.0.1:8787","client_token":"stale","device_name":"desk"}"#;
        let next = shell_config_json_with_server_url(Some(raw), "http://192.168.1.10:8787").unwrap();

        let reloaded = load_shell_config_from_json_and_env(Some(&next), |_| None).unwrap();

        assert_eq!(reloaded.server_url, "http://192.168.1.10:8787");
        assert_eq!(reloaded.client_token, None);
        assert_eq!(reloaded.device_name, "desk");
    }

    // 首次写入（配置文件还不存在）也要产出一份合法可重读的配置。
    #[test]
    fn writing_without_an_existing_shell_config_file_creates_a_valid_one() {
        let next = shell_config_json_with_server_url(None, "https://workhub.example.com").unwrap();
        let reloaded = load_shell_config_from_json_and_env(Some(&next), |_| None).unwrap();

        assert_eq!(reloaded.server_url, "https://workhub.example.com");
        assert_eq!(reloaded.device_name, WorkHubShellConfig::lan_default().device_name);
    }

    #[test]
    fn refuses_to_rewrite_a_shell_config_that_is_not_a_json_object() {
        assert!(matches!(
            shell_config_json_with_server_url(Some("[1,2,3]"), "http://127.0.0.1:8787"),
            Err(WorkHubShellConfigLoadError::InvalidJson(_))
        ));
        assert!(matches!(
            shell_config_json_with_server_url(Some("{not json"), "http://127.0.0.1:8787"),
            Err(WorkHubShellConfigLoadError::InvalidJson(_))
        ));
    }
}
