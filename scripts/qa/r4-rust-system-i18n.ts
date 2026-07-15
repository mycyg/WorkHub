import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CommandResult = {
  command: string;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
};

type CargoMode = "executed" | "skipped-by-env";

type Report = {
  generated_at: string;
  module: string;
  output_dir: string;
  cargo_mode: CargoMode;
  commands: CommandResult[];
  gates: Record<string, boolean>;
  evidence: Record<string, string[]>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 生成型审计产物落 gitignored artifacts 区,不改写 tracked 文件——verify 末尾有 git diff --exit-code 门。
const outputDir = path.join(repoRoot, "artifacts", "qa", "r4-rust-system-i18n");

const sources = {
  locale: path.join(repoRoot, "client-tauri", "src-tauri", "src", "locale.rs"),
  config: path.join(repoRoot, "client-tauri", "src-tauri", "src", "config.rs"),
  tray: path.join(repoRoot, "client-tauri", "src-tauri", "src", "tray.rs"),
  notify: path.join(repoRoot, "client-tauri", "src-tauri", "src", "notify.rs"),
  sseWorker: path.join(repoRoot, "client-tauri", "src-tauri", "src", "sse_worker.rs"),
  deepLink: path.join(repoRoot, "client-tauri", "src-tauri", "src", "deep_link.rs"),
  singleInstance: path.join(repoRoot, "client-tauri", "src-tauri", "src", "single_instance.rs"),
  main: path.join(repoRoot, "client-tauri", "src-tauri", "src", "main.rs")
};

function tail(value: string, max = 4000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function run(command: string, args: string[], cwd = repoRoot): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        command: [command, ...args].join(" "),
        exitCode: null,
        stdoutTail: tail(stdout),
        stderrTail: tail(`${stderr}\n${error.message}`)
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        command: [command, ...args].join(" "),
        exitCode,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr)
      });
    });
  });
}

function hasAll(source: string, snippets: string[]): boolean {
  return snippets.every((snippet) => source.includes(snippet));
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  // CI 的 JS workspace job 缺少 Tauri 的 GTK/WebKit 系统依赖；cargo 门由专属
  // rust-system-i18n job 执行。默认（无 env）仍 fail-closed 跑 cargo。
  const cargoMode: CargoMode =
    process.env.WORKHUB_RUST_I18N_CARGO === "skip" ? "skipped-by-env" : "executed";
  const cargo: CommandResult =
    cargoMode === "executed"
      ? await run("cargo", [
        "test",
        "--manifest-path",
        path.join(repoRoot, "client-tauri", "src-tauri", "Cargo.toml")
      ])
      : {
        command: "cargo test (skipped: WORKHUB_RUST_I18N_CARGO=skip)",
        exitCode: 0,
        stdoutTail: "",
        stderrTail: ""
      };
  if (cargoMode === "executed" && cargo.exitCode !== 0) {
    console.error(cargo.stderrTail);
  }

  const [
    localeSource,
    configSource,
    traySource,
    notifySource,
    sseWorkerSource,
    deepLinkSource,
    singleInstanceSource,
    mainSource
  ] = await Promise.all([
    readFile(sources.locale, "utf8"),
    readFile(sources.config, "utf8"),
    readFile(sources.tray, "utf8"),
    readFile(sources.notify, "utf8"),
    readFile(sources.sseWorker, "utf8"),
    readFile(sources.deepLink, "utf8"),
    readFile(sources.singleInstance, "utf8"),
    readFile(sources.main, "utf8")
  ]);

  const evidence = {
    locale_contract: ["WorkHubLocale::ZhCn", "WorkHubLocale::EnUs", "WORKHUB_LOCALE_ENV"],
    tray_copy: ["打开 WorkHub", "Open WorkHub", "恢复 Cuu 交互", "Restore Cuu interaction"],
    notification_copy: ["Cuu 需要你的审批", "Cuu needs your approval", "打开 WorkHub", "Open WorkHub"],
    dynamic_boundaries: ["dynamic_notification_payload_text_is_not_client_translated"],
    diagnostics: ["describe_deep_link_error", "single_instance_plan_from_args_for_locale"]
  };

  const gates: Record<string, boolean> = {
    cargo_tests_passed: cargo.exitCode === 0,
    locale_contract_has_two_values: hasAll(localeSource, evidence.locale_contract),
    shell_config_consumes_locale: hasAll(configSource, [
      "locale: WorkHubLocale",
      "WORKHUB_LOCALE_ENV",
      "normalize_workhub_locale"
    ]),
    tray_labels_and_tooltip_bilingual: hasAll(traySource, [
      "tray_tooltip",
      "WorkHub - Cuu 已就绪",
      "WorkHub - Cuu is ready",
      "恢复 Cuu 交互",
      "Restore Cuu interaction"
    ]),
    main_installs_tray_with_shell_locale: hasAll(mainSource, [
      "install_workhub_tray(app, shell_config.locale)",
      "tray_menu_action_plan_by_id_for_locale(id, locale)",
      "current_workhub_locale(app)"
    ]),
    notification_fallbacks_bilingual: hasAll(notifySource, [
      "fallback_title_for_event",
      "fallback_body_for_event",
      "AI 预算已耗尽",
      "AI budget is exhausted",
      "WorkHub 有新的提醒",
      "WorkHub has a new alert"
    ]),
    dynamic_notification_payload_preserved: hasAll(notifySource, evidence.dynamic_boundaries),
    sse_worker_passes_locale_to_notification_plan: hasAll(sseWorkerSource, [
      "let locale = config.locale",
      "system_notification_plan_from_push_payload_for_locale(&payload, locale)"
    ]),
    deep_link_diagnostics_bilingual: hasAll(deepLinkSource, [
      "describe_deep_link_error",
      "不安全的打开目标",
      "Unsafe open target"
    ]),
    single_instance_rejections_bilingual: hasAll(singleInstanceSource, [
      "single_instance_plan_from_args_for_locale",
      "describe_deep_link_error(&error, locale)",
      "不安全的打开目标"
    ])
  };

  const report: Report = {
    generated_at: new Date().toISOString(),
    module: "R4.6 Rust system-string i18n",
    output_dir: outputDir,
    cargo_mode: cargoMode,
    commands: [cargo],
    gates,
    evidence
  };

  await writeFile(
    path.join(outputDir, "rust-system-i18n-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outputDir, "smoke-summary.md"),
    [
      "# R4.6 Rust System I18n Smoke",
      "",
      `- generated_at: ${report.generated_at}`,
      `- cargo_mode: ${cargoMode}`,
      `- cargo_tests_passed: ${String(gates.cargo_tests_passed)}`,
      `- all_gates_passed: ${String(Object.values(gates).every(Boolean))}`,
      `- report: ${path.relative(repoRoot, path.join(outputDir, "rust-system-i18n-report.json")).replace(/\\/gu, "/")}`,
      ""
    ].join("\n"),
    "utf8"
  );

  const failed = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`R4.6 Rust system i18n gates failed: ${failed.join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
