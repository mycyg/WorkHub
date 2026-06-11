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
