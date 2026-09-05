use serde::{Deserialize, Serialize};
use url::Url;

use crate::locale::{normalize_workhub_locale, WorkHubLocale, WORKHUB_LOCALE_ENV};

pub const WORKHUB_SERVER_URL_ENV: &str = "WORKHUB_SERVER_URL";
pub const WORKHUB_CLIENT_TOKEN_ENV: &str = "WORKHUB_CLIENT_TOKEN";
pub const LEGACY_CLIENT_TOKEN_ENV: &str = "YQGL_CLIENT_TOKEN";
pub const WORKHUB_DEVICE_NAME_ENV: &str = "WORKHUB_DEVICE_NAME";

/// 谁都问不出机器名时的兜底设备名。与 webview 侧 desktop-login.ts / desktop-rebind.ts 的同名字面量
/// 一致（大小写也一致）——两边都会作为 `device_name` 报到服务端，设备列表里必须是同一个词。
pub const DEFAULT_DEVICE_NAME: &str = "WorkHub Desktop";

/// 设备名上限。服务端不限长，但设置页的设备列表是一行一台（spotlight/views/settings.ts），
/// 太长会把「平台 · 最后在线 · 状态」那半行挤没。按字符数截断（不是字节），中文机器名同样安全。
const DEVICE_NAME_MAX_CHARS: usize = 48;

/// 把一个系统来源的机器名归一成可用的设备名，问不出东西时返回 None（调用方继续问下一个来源）。
///
/// S5-M-07 根因：设备名此前恒为一个常量，同一账号在两台 mac 上装了包，设置页的设备列表就是两行同名，
/// 只能靠时间戳猜该撤销哪一个。机器名是 macOS「共享」偏好里用户自己起的名字（`scutil --get ComputerName`，
/// 例如「Ada 的 MacBook Pro」），正是用来分辨设备的。
///
/// 归一口径：
/// - 去首尾空白与引号；`hostname` 可能给出 FQDN，只取首段，并丢掉 `.local` / `.lan` 这类自动后缀；
/// - 内部空白压成单个空格（`scutil` 的机器名允许空格，日志/展示都按一行处理）；
/// - `localhost` 一族当成"没有信息"——它分辨不出任何东西，还不如兜底名；
/// - 超长按字符截断。
pub fn normalize_system_device_name(raw: &str) -> Option<String> {
    let head = raw.trim().trim_matches('"').trim();
    // FQDN（`host.example.com`）与 mDNS 名（`ada-mbp.local`）都只保留首段。
    let head = head.split('.').next().unwrap_or_default().trim();
    let collapsed = head.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() || collapsed.eq_ignore_ascii_case("localhost") {
        return None;
    }
    Some(collapsed.chars().take(DEVICE_NAME_MAX_CHARS).collect())
}

/// 按顺序问若干个系统来源，取第一个能归一出名字的（来源由调用方注入，便于单测）。
pub fn detect_system_device_name<I, S>(candidates: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    candidates
        .into_iter()
        .find_map(|value| normalize_system_device_name(value.as_ref()))
}

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
            device_name: DEFAULT_DEVICE_NAME.to_string(),
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
    load_shell_config_from_json_env_and_system(raw_json, env_value, None)
}

/// 保留三参签名（既有调用方/测试零改动），系统机器名一层交给下面的四参版本。
pub fn load_shell_config_from_json_env_and_system<F>(
    raw_json: Option<&str>,
    env_value: F,
    system_locale: Option<WorkHubLocale>,
) -> Result<WorkHubShellConfig, WorkHubShellConfigLoadError>
where
    F: Fn(&str) -> Option<String>,
{
    load_shell_config_from_json_env_system_and_device(raw_json, env_value, system_locale, None)
}

/// 启动配置的完整解析。语言的优先级（从低到高）：
/// 1. `DEFAULT_WORKHUB_LOCALE`（谁都问不出来时的兜底）；
/// 2. **系统语言**（`system_locale`,由 main.rs 用 `detect_system_workhub_locale` 探测）；
/// 3. `workhub-shell-config.json` 里的 `locale`；
/// 4. `WORKHUB_LOCALE` 环境变量。
///
/// S3 严重 #4 修的就是第 2 层此前压根不存在——壳层的语言写死中文,英文系统上托盘菜单/窗口标题全中文。
/// 显式配置（3/4）永远压过系统语言：用户手改过就不该被系统设置反悔。webview 侧切语言走
/// `set_shell_locale` 命令,那是运行时覆盖,不经过这里。
///
/// 设备名走同一套分层（S5-M-07）：`DEFAULT_DEVICE_NAME` < **机器名**（`system_device_name`,
/// 由 main.rs 用 `scutil --get ComputerName` / `hostname` 探测） < 配置文件的 `device_name`
/// < `WORKHUB_DEVICE_NAME` 环境变量。
pub fn load_shell_config_from_json_env_system_and_device<F>(
    raw_json: Option<&str>,
    env_value: F,
    system_locale: Option<WorkHubLocale>,
    system_device_name: Option<String>,
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
    if let Some(locale) = system_locale {
        config.locale = locale;
    }
    // 与系统语言同一套分层：机器名只是比常量兜底更好的**默认**，显式配置（文件/环境变量）永远压过它。
    if let Some(device_name) = clean_optional(system_device_name) {
        config.device_name = device_name;
    }
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

    // S5-M-07：设备名恒为常量 → 同一账号两台 mac 在设备列表里两行同名，只能靠时间戳猜该撤销哪台。
    // 机器名（macOS「共享」里用户自己起的名字）才是用来分辨设备的东西。
    #[test]
    fn machine_names_are_normalized_into_usable_device_names() {
        assert_eq!(
            normalize_system_device_name("  Ada 的 MacBook Pro \n"),
            Some("Ada 的 MacBook Pro".to_string())
        );
        // hostname 可能给 FQDN / mDNS 名：只取首段，丢掉自动后缀。
        assert_eq!(
            normalize_system_device_name("ada-mbp.local"),
            Some("ada-mbp".to_string())
        );
        assert_eq!(
            normalize_system_device_name("desk.office.example.com"),
            Some("desk".to_string())
        );
        // scutil 的输出偶尔带引号；内部空白压成单个空格。
        assert_eq!(
            normalize_system_device_name("\"Ada\u{2019}s   Mac\""),
            Some("Ada\u{2019}s Mac".to_string())
        );
        // 分辨不出任何东西的值等于「没问到」，让调用方继续问下一个来源。
        assert_eq!(normalize_system_device_name(""), None);
        assert_eq!(normalize_system_device_name("   "), None);
        assert_eq!(normalize_system_device_name("localhost"), None);
        assert_eq!(normalize_system_device_name("localhost.localdomain"), None);
        // 超长按字符截断（不是字节，中文机器名同样安全）。
        let long = "机".repeat(80);
        assert_eq!(
            normalize_system_device_name(&long).unwrap().chars().count(),
            DEVICE_NAME_MAX_CHARS
        );
    }

    #[test]
    fn system_device_name_takes_the_first_source_that_knows_something() {
        assert_eq!(
            detect_system_device_name(["", "localhost", "Ada 的 Mac", "ignored"]),
            Some("Ada 的 Mac".to_string())
        );
        assert_eq!(detect_system_device_name(["", "  ", "localhost"]), None);
        assert_eq!(detect_system_device_name(Vec::<String>::new()), None);
    }

    // 分层与语言同款：机器名只是更好的默认，配置文件与环境变量永远压过它；一台都问不出来时回兜底常量。
    #[test]
    fn device_name_prefers_explicit_configuration_over_the_machine_name() {
        let from_system = load_shell_config_from_json_env_system_and_device(
            None,
            |_| None,
            None,
            Some("Ada 的 Mac".to_string()),
        )
        .unwrap();
        assert_eq!(from_system.device_name, "Ada 的 Mac");

        let from_file = load_shell_config_from_json_env_system_and_device(
            Some(r#"{"device_name":"客厅那台"}"#),
            |_| None,
            None,
            Some("Ada 的 Mac".to_string()),
        )
        .unwrap();
        assert_eq!(from_file.device_name, "客厅那台");

        let from_env = load_shell_config_from_json_env_system_and_device(
            Some(r#"{"device_name":"客厅那台"}"#),
            |name| (name == WORKHUB_DEVICE_NAME_ENV).then(|| "CI runner".to_string()),
            None,
            Some("Ada 的 Mac".to_string()),
        )
        .unwrap();
        assert_eq!(from_env.device_name, "CI runner");

        let nothing_known =
            load_shell_config_from_json_env_system_and_device(None, |_| None, None, None).unwrap();
        assert_eq!(nothing_known.device_name, DEFAULT_DEVICE_NAME);
    }

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

    // S3 严重 #4：没有任何显式配置时，壳层语言必须跟随系统，而不是写死中文。
    #[test]
    fn system_locale_replaces_the_hard_coded_chinese_default() {
        let english =
            load_shell_config_from_json_env_and_system(None, |_| None, Some(WorkHubLocale::EnUs))
                .unwrap();
        assert_eq!(english.locale, WorkHubLocale::EnUs);

        let chinese =
            load_shell_config_from_json_env_and_system(None, |_| None, Some(WorkHubLocale::ZhCn))
                .unwrap();
        assert_eq!(chinese.locale, WorkHubLocale::ZhCn);

        // 探测不出系统语言时保留既有默认，不改变行为。
        let unknown = load_shell_config_from_json_env_and_system(None, |_| None, None).unwrap();
        assert_eq!(unknown.locale, WorkHubLocale::default());
    }

    // 显式配置永远压过系统语言：用户手改过（文件或环境变量）就不该被系统设置反悔。
    #[test]
    fn explicit_locale_configuration_outranks_the_system_language() {
        let from_file = load_shell_config_from_json_env_and_system(
            Some(r#"{"locale":"zh-CN"}"#),
            |_| None,
            Some(WorkHubLocale::EnUs),
        )
        .unwrap();
        assert_eq!(from_file.locale, WorkHubLocale::ZhCn);

        let from_env = load_shell_config_from_json_env_and_system(
            Some(r#"{"locale":"zh-CN"}"#),
            |name| (name == WORKHUB_LOCALE_ENV).then(|| "en-US".to_string()),
            Some(WorkHubLocale::ZhCn),
        )
        .unwrap();
        assert_eq!(from_env.locale, WorkHubLocale::EnUs);
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
        assert_eq!(
            normalize_shell_server_url("   "),
            Err(ShellServerUrlError::Empty)
        );
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
            Err(ShellServerUrlError::UnsupportedScheme(
                "javascript".to_string()
            ))
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
        let raw =
            r#"{"server_url":"http://127.0.0.1:8787","client_token":"stale","device_name":"desk"}"#;
        let next =
            shell_config_json_with_server_url(Some(raw), "http://192.168.1.10:8787").unwrap();

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
        assert_eq!(
            reloaded.device_name,
            WorkHubShellConfig::lan_default().device_name
        );
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
