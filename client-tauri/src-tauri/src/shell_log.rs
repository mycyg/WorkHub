//! BX-01：Rust 壳层的统一日志出口。
//!
//! 在此之前壳层的所有诊断都是散落的 `eprintln!`（main.rs 20 处、sse_worker.rs 2 处）。开发时从终端跑
//! 还看得到，一旦打包成 `.app` 双击启动，stderr 没有任何人在读——用户报"深链没反应 / Cuu 一直离线"时，
//! 现场没有任何可回收的证据。
//!
//! 这里不引新 crate（Cargo.lock 里只有 `log`/`tracing` 两个传递依赖，都没有配套的 file appender，
//! 而 `tauri-plugin-log` 根本不在依赖树里），自建一个最小出口：
//! **stderr 照旧 + 追加写应用日志目录下按天滚动的文件，最多保留 5 天**。
//!
//! 设计上刻意保守：
//! - 落盘是 best-effort。写日志失败绝不 panic、绝不上抛、绝不递归打日志——日志系统自己坏掉时，
//!   应用必须照常工作。
//! - 文件出口在 `.setup()` 里装（`init_shell_log_dir`）。装好之前的日志（插件初始化等）只进 stderr，
//!   这是可接受的：那个阶段的失败会直接体现为"应用起不来"，另有出口。
//! - 时间格式化是自己算的（无 chrono/time 依赖），纯函数，见 `utc_parts_from_unix_seconds`。

use std::{
    fmt::Display,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

/// 按天滚动的日志文件最多保留几个。
pub const SHELL_LOG_FILES_KEPT: usize = 5;
const SHELL_LOG_FILE_PREFIX: &str = "workhub-";
const SHELL_LOG_FILE_SUFFIX: &str = ".log";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellLogLevel {
    Info,
    Warn,
    Error,
}

impl ShellLogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            ShellLogLevel::Info => "INFO",
            ShellLogLevel::Warn => "WARN",
            ShellLogLevel::Error => "ERROR",
        }
    }
}

struct ShellLogSink {
    dir: PathBuf,
    /// 上一次写入用的文件名。只有翻篇（跨天/首次）时才去扫目录做清理，不是每行都扫。
    last_file_name: Option<String>,
}

fn sink() -> &'static Mutex<Option<ShellLogSink>> {
    static SINK: OnceLock<Mutex<Option<ShellLogSink>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

/// 装上文件出口（`.setup()` 里调一次，参数是 `BaseDirectory::AppLog` 解析出来的目录）。
/// 目录建不出来就只留 stderr，不算失败。
pub fn init_shell_log_dir(dir: PathBuf) {
    if let Err(error) = fs::create_dir_all(&dir) {
        eprintln!(
            "WorkHub: could not create the log directory {}; logging to stderr only: {error}",
            dir.display()
        );
        return;
    }
    if let Ok(mut guard) = sink().lock() {
        *guard = Some(ShellLogSink {
            dir,
            last_file_name: None,
        });
    }
}

/// 壳层日志的唯一入口。`event` 是稳定的机器可读事件名（snake_case，便于日后 grep/统计），
/// `message` 是给人读的一句话（可带原始错误）。
pub fn shell_log(level: ShellLogLevel, event: &str, message: impl Display) {
    let line = format_shell_log_line(&now_utc_timestamp(), level, event, &message.to_string());
    eprintln!("{line}");
    append_to_log_file(&line);
}

pub fn shell_log_info(event: &str, message: impl Display) {
    shell_log(ShellLogLevel::Info, event, message);
}

pub fn shell_log_warn(event: &str, message: impl Display) {
    shell_log(ShellLogLevel::Warn, event, message);
}

pub fn shell_log_error(event: &str, message: impl Display) {
    shell_log(ShellLogLevel::Error, event, message);
}

fn append_to_log_file(line: &str) {
    let Ok(mut guard) = sink().lock() else {
        return;
    };
    let Some(state) = guard.as_mut() else {
        return;
    };
    let file_name = shell_log_file_name(&today_utc_date());
    let path = state.dir.join(&file_name);
    let rolled = state.last_file_name.as_deref() != Some(file_name.as_str());
    // 落盘失败一律沉默：这里再 eprintln 会在磁盘满/只读卷上把 stderr 也刷爆。
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
    if rolled {
        state.last_file_name = Some(file_name);
        prune_shell_log_files(&state.dir, SHELL_LOG_FILES_KEPT);
    }
}

fn prune_shell_log_files(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let names = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect::<Vec<_>>();
    for name in shell_log_files_to_prune(&names, keep) {
        let _ = fs::remove_file(dir.join(name));
    }
}

/// 挑出该删的日志文件（纯函数）。文件名里的日期是定宽的 `YYYY-MM-DD`，字典序即时间序，
/// 保留最新的 `keep` 个，其余全删；不认识的文件名一概不碰（别人的文件不归我们删）。
pub fn shell_log_files_to_prune(file_names: &[String], keep: usize) -> Vec<String> {
    let mut ours = file_names
        .iter()
        .filter(|name| {
            name.starts_with(SHELL_LOG_FILE_PREFIX) && name.ends_with(SHELL_LOG_FILE_SUFFIX)
        })
        .cloned()
        .collect::<Vec<_>>();
    ours.sort();
    if ours.len() <= keep {
        return Vec::new();
    }
    ours.truncate(ours.len() - keep);
    ours
}

pub fn shell_log_file_name(day: &str) -> String {
    format!("{SHELL_LOG_FILE_PREFIX}{day}{SHELL_LOG_FILE_SUFFIX}")
}

/// 一行日志的形状（纯函数）：`<RFC3339 UTC> <LEVEL> <event> <message>`。
/// 换行会把一行日志撑成多行、破坏按行 grep，统一压成空格。
pub fn format_shell_log_line(
    timestamp: &str,
    level: ShellLogLevel,
    event: &str,
    message: &str,
) -> String {
    let flattened = message.replace(['\n', '\r'], " ");
    let trimmed = flattened.trim();
    if trimmed.is_empty() {
        format!("{timestamp} {} {event}", level.as_str())
    } else {
        format!("{timestamp} {} {event} {trimmed}", level.as_str())
    }
}

fn unix_seconds_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

fn now_utc_timestamp() -> String {
    format_utc_timestamp(unix_seconds_now())
}

fn today_utc_date() -> String {
    format_utc_date(unix_seconds_now())
}

pub fn format_utc_timestamp(unix_seconds: i64) -> String {
    let (year, month, day, hour, minute, second) = utc_parts_from_unix_seconds(unix_seconds);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

pub fn format_utc_date(unix_seconds: i64) -> String {
    let (year, month, day, ..) = utc_parts_from_unix_seconds(unix_seconds);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Unix 秒 → UTC 的 (年, 月, 日, 时, 分, 秒)。
///
/// 用 Howard Hinnant 的 civil_from_days（`chrono`/`time` 内部同款算法）。自己算是因为依赖树里
/// 没有任何日期库，而为了一个时间戳新增一个直接依赖不划算——这段是纯算术，有单测钉住。
pub fn utc_parts_from_unix_seconds(unix_seconds: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = unix_seconds.div_euclid(86_400);
    let seconds_of_day = unix_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    (
        year,
        month,
        day,
        (seconds_of_day / 3_600) as u32,
        ((seconds_of_day % 3_600) / 60) as u32,
        (seconds_of_day % 60) as u32,
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64; // [0, 146096]
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365; // [0, 399]
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100); // [0, 365]
    let month_position = (5 * day_of_year + 2) / 153; // [0, 11]
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32; // [1, 31]
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32; // [1, 12]
    (year + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_a_greppable_single_line_shape() {
        assert_eq!(
            format_shell_log_line(
                "2026-09-05T07:19:16Z",
                ShellLogLevel::Warn,
                "deep_link_failed",
                "invalid WorkHub deep link workhub://open/nope"
            ),
            "2026-09-05T07:19:16Z WARN deep_link_failed invalid WorkHub deep link workhub://open/nope"
        );
        // 多行错误压成一行，否则按行 grep 会把后半截当成独立日志。
        assert_eq!(
            format_shell_log_line(
                "2026-09-05T07:19:16Z",
                ShellLogLevel::Error,
                "sse_failed",
                "connect error:\n  caused by: refused\r\n"
            ),
            "2026-09-05T07:19:16Z ERROR sse_failed connect error:   caused by: refused"
        );
        // 没有 message 时也不留尾随空格。
        assert_eq!(
            format_shell_log_line("2026-09-05T07:19:16Z", ShellLogLevel::Info, "started", "  "),
            "2026-09-05T07:19:16Z INFO started"
        );
    }

    #[test]
    fn converts_unix_seconds_to_utc_civil_parts() {
        assert_eq!(utc_parts_from_unix_seconds(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(
            utc_parts_from_unix_seconds(1_000_000_000),
            (2001, 9, 9, 1, 46, 40)
        );
        // 闰日不能错位。
        assert_eq!(
            utc_parts_from_unix_seconds(951_782_400),
            (2000, 2, 29, 0, 0, 0)
        );
        assert_eq!(
            utc_parts_from_unix_seconds(1_772_694_000),
            (2026, 3, 5, 7, 0, 0)
        );
        // 纪元之前（时钟被设歪）也不能 panic/算错。
        assert_eq!(utc_parts_from_unix_seconds(-1), (1969, 12, 31, 23, 59, 59));
        assert_eq!(format_utc_timestamp(1_788_591_600), "2026-09-05T07:00:00Z");
        assert_eq!(format_utc_date(1_788_591_600), "2026-09-05");
    }

    #[test]
    fn keeps_only_the_newest_log_files_and_never_touches_foreign_ones() {
        let names = vec![
            "workhub-2026-09-01.log".to_string(),
            "workhub-2026-09-02.log".to_string(),
            "workhub-2026-09-03.log".to_string(),
            "workhub-2026-09-04.log".to_string(),
            "workhub-2026-09-05.log".to_string(),
            "workhub-2026-09-06.log".to_string(),
            "workhub-2026-09-07.log".to_string(),
            // 不是我们的文件，一概不碰。
            "somebody-else.log".to_string(),
            "workhub-2026-09-07.log.bak".to_string(),
            "notes.txt".to_string(),
        ];

        assert_eq!(
            shell_log_files_to_prune(&names, SHELL_LOG_FILES_KEPT),
            vec![
                "workhub-2026-09-01.log".to_string(),
                "workhub-2026-09-02.log".to_string()
            ]
        );
        // 还没超过上限时什么都不删。
        assert!(shell_log_files_to_prune(&names[..3], SHELL_LOG_FILES_KEPT).is_empty());
        assert_eq!(shell_log_file_name("2026-09-05"), "workhub-2026-09-05.log");
    }
}
