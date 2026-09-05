use serde::{Deserialize, Serialize};

pub const WORKHUB_LOCALE_ENV: &str = "WORKHUB_LOCALE";
pub const DEFAULT_WORKHUB_LOCALE: WorkHubLocale = WorkHubLocale::ZhCn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkHubLocale {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

impl WorkHubLocale {
    pub fn as_str(self) -> &'static str {
        match self {
            WorkHubLocale::ZhCn => "zh-CN",
            WorkHubLocale::EnUs => "en-US",
        }
    }
}

impl Default for WorkHubLocale {
    fn default() -> Self {
        DEFAULT_WORKHUB_LOCALE
    }
}

pub fn normalize_workhub_locale(value: &str) -> WorkHubLocale {
    let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
    if normalized == "en" || normalized.starts_with("en-") {
        return WorkHubLocale::EnUs;
    }
    if normalized == "zh" || normalized == "zh-cn" || normalized.starts_with("zh-hans") {
        return WorkHubLocale::ZhCn;
    }
    DEFAULT_WORKHUB_LOCALE
}

pub fn normalize_optional_workhub_locale(value: Option<String>) -> Option<WorkHubLocale> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| normalize_workhub_locale(&value))
}

/// POSIX locale 环境变量,按 POSIX 规定的优先级排列（LC_ALL 覆盖一切,LANG 兜底）。
pub const SYSTEM_LOCALE_ENV_VARS: &[&str] = &["LC_ALL", "LC_MESSAGES", "LANG"];

/// 把一个**系统**语言标签映射到壳层语言。
///
/// 与 `normalize_workhub_locale`（用于显式配置值）刻意不同口径：显式配置里认不出的值回落
/// `DEFAULT_WORKHUB_LOCALE`（中文），但系统语言认不出时**不能**回落中文——S3 严重 #4 的表现正是
/// 一台英文系统上托盘菜单/窗口标题全中文。这里的规则是「zh* → 中文,其余任何真实语言 → 英文」。
///
/// 返回 None 表示「这个值不携带语言信息」（空串、POSIX 的 `C`），调用方应继续问下一个来源。
/// 接受的形状覆盖两类来源：POSIX 的 `zh_CN.UTF-8@pinyin`,与 macOS AppleLanguages 的 `zh-Hans-CN`。
pub fn workhub_locale_from_system_tag(raw: &str) -> Option<WorkHubLocale> {
    let head = raw
        .trim()
        .trim_matches('"')
        .split(['.', '@'])
        .next()
        .unwrap_or_default()
        .trim();
    let normalized = head.to_ascii_lowercase().replace('_', "-");
    if normalized.is_empty() || normalized == "c" || normalized == "posix" {
        return None;
    }
    if normalized == "zh" || normalized.starts_with("zh-") {
        return Some(WorkHubLocale::ZhCn);
    }
    Some(WorkHubLocale::EnUs)
}

/// 探测系统语言（纯函数,来源由调用方注入,便于单测）。
///
/// 顺序：先 OS 的首选语言列表（macOS 的 AppleLanguages——`.app` 双击启动时**没有** shell 环境变量,
/// 这才是 GUI 应用唯一可靠的来源），再退回 POSIX 环境变量（Linux/Windows,以及从终端启动的 mac）。
/// 全都问不出来时回 None,由调用方保留 `DEFAULT_WORKHUB_LOCALE`。
pub fn detect_system_workhub_locale<F>(
    preferred_languages: &[String],
    env_value: F,
) -> Option<WorkHubLocale>
where
    F: Fn(&str) -> Option<String>,
{
    if let Some(locale) = preferred_languages
        .iter()
        .find_map(|tag| workhub_locale_from_system_tag(tag))
    {
        return Some(locale);
    }
    SYSTEM_LOCALE_ENV_VARS
        .iter()
        .filter_map(|name| env_value(name))
        .find_map(|value| workhub_locale_from_system_tag(&value))
}

/// 解析 macOS `defaults read -g AppleLanguages` 的输出（旧式 plist 数组）：
/// ```text
/// (
///     "zh-Hans-CN",
///     en-CN
/// )
/// ```
/// 也接受 `defaults read -g AppleLocale` 那种单行标量（`zh_CN`）。纯字符串处理,不引新依赖。
pub fn parse_macos_preferred_languages(raw: &str) -> Vec<String> {
    raw.lines()
        .map(|line| {
            line.trim()
                .trim_start_matches('(')
                .trim_end_matches(')')
                .trim()
                .trim_end_matches(',')
                .trim()
                .trim_matches('"')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_supported_locale_families() {
        assert_eq!(normalize_workhub_locale("en"), WorkHubLocale::EnUs);
        assert_eq!(normalize_workhub_locale("en-SG"), WorkHubLocale::EnUs);
        assert_eq!(normalize_workhub_locale("en_GB"), WorkHubLocale::EnUs);
        assert_eq!(normalize_workhub_locale("zh"), WorkHubLocale::ZhCn);
        assert_eq!(normalize_workhub_locale("zh-CN"), WorkHubLocale::ZhCn);
        assert_eq!(normalize_workhub_locale("zh-Hans"), WorkHubLocale::ZhCn);
    }

    #[test]
    fn falls_back_to_chinese_for_unknown_or_empty_locale() {
        assert_eq!(normalize_workhub_locale("fr-FR"), WorkHubLocale::ZhCn);
        assert_eq!(normalize_workhub_locale(""), WorkHubLocale::ZhCn);
        assert_eq!(WorkHubLocale::default(), WorkHubLocale::ZhCn);
    }

    // S3 严重 #4：系统语言认不出时**不能**回落中文——英文系统上托盘/标题全中文正是那条发现。
    #[test]
    fn system_tags_map_chinese_to_chinese_and_everything_else_to_english() {
        assert_eq!(
            workhub_locale_from_system_tag("zh_CN.UTF-8"),
            Some(WorkHubLocale::ZhCn)
        );
        assert_eq!(
            workhub_locale_from_system_tag("zh-Hans-CN"),
            Some(WorkHubLocale::ZhCn)
        );
        assert_eq!(
            workhub_locale_from_system_tag("\"zh-Hant-TW\""),
            Some(WorkHubLocale::ZhCn)
        );
        assert_eq!(
            workhub_locale_from_system_tag("en_US.UTF-8"),
            Some(WorkHubLocale::EnUs)
        );
        // 第三语言：宁可英文也不要莫名其妙的中文。
        assert_eq!(
            workhub_locale_from_system_tag("fr-FR"),
            Some(WorkHubLocale::EnUs)
        );
        assert_eq!(
            workhub_locale_from_system_tag("ja_JP.UTF-8@calendar=japanese"),
            Some(WorkHubLocale::EnUs)
        );
        // 不携带语言信息 → 继续问下一个来源。
        assert_eq!(workhub_locale_from_system_tag(""), None);
        assert_eq!(workhub_locale_from_system_tag("   "), None);
        assert_eq!(workhub_locale_from_system_tag("C"), None);
        assert_eq!(workhub_locale_from_system_tag("C.UTF-8"), None);
        assert_eq!(workhub_locale_from_system_tag("POSIX"), None);
    }

    #[test]
    fn system_locale_prefers_the_os_language_list_over_posix_env_vars() {
        // macOS：.app 双击启动没有 shell 环境变量,AppleLanguages 是唯一来源。
        assert_eq!(
            detect_system_workhub_locale(&["zh-Hans-CN".to_string()], |_| None),
            Some(WorkHubLocale::ZhCn)
        );
        // 系统设置说中文,终端里恰好 LANG=en_US —— 以系统设置为准。
        assert_eq!(
            detect_system_workhub_locale(&["zh-Hans-CN".to_string()], |name| (name == "LANG")
                .then(|| "en_US.UTF-8".to_string())),
            Some(WorkHubLocale::ZhCn)
        );
        // 没有 OS 列表（Linux/Windows）→ 回落 POSIX 变量,LC_ALL 优先于 LANG。
        assert_eq!(
            detect_system_workhub_locale(&[], |name| match name {
                "LC_ALL" => Some("en_GB.UTF-8".to_string()),
                "LANG" => Some("zh_CN.UTF-8".to_string()),
                _ => None,
            }),
            Some(WorkHubLocale::EnUs)
        );
        // 只有不携带语言信息的值 → None,调用方保留默认。
        assert_eq!(
            detect_system_workhub_locale(&["".to_string()], |name| (name == "LANG")
                .then(|| "C".to_string())),
            None
        );
        assert_eq!(detect_system_workhub_locale(&[], |_| None), None);
    }

    #[test]
    fn parses_the_apple_languages_defaults_output() {
        let raw = "(\n    \"zh-Hans-CN\",\n    \"en-CN\"\n)\n";

        assert_eq!(
            parse_macos_preferred_languages(raw),
            vec!["zh-Hans-CN".to_string(), "en-CN".to_string()]
        );
        // AppleLocale 那种单行标量同样能读。
        assert_eq!(
            parse_macos_preferred_languages("zh_CN\n"),
            vec!["zh_CN".to_string()]
        );
        assert!(parse_macos_preferred_languages("").is_empty());
        assert!(parse_macos_preferred_languages("(\n)\n").is_empty());
    }

    #[test]
    fn serializes_as_shared_contract_values() {
        assert_eq!(
            serde_json::to_string(&WorkHubLocale::ZhCn).unwrap(),
            r#""zh-CN""#
        );
        assert_eq!(
            serde_json::to_string(&WorkHubLocale::EnUs).unwrap(),
            r#""en-US""#
        );
    }
}
