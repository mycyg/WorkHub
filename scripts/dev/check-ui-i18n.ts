/**
 * 用户可见文案 locale 独占门禁：中文字面量只许住在词典文件里。
 *
 * 形状借鉴 deepseek-harness 的 `scripts/verify-client-ui-i18n.ts`（MIT,
 * Copyright (c) 2026 DeepSeek）：TypeScript 编译器 API 遍历 + 「只有 locale 文件
 * 可以拥有译文」的允许列表 + `MINIMUM_SOURCES` 下限防扫描器自身失效。
 * 本地改造：上游按 JSX 文本 / 14 个文案属性 / 后缀正则判定「这是文案」，我们没有
 * JSX，改成更简单也更准的判据——**含汉字的字符串字面量**；并加了一层棘轮基线
 * （`ui-i18n-baseline.json`），因为存量一次迁不完。
 *
 * 判定规则：
 *   - 只看 AST 上的字符串字面量与模板字面量（注释里的中文天然不算，正则字面量也不算）。
 *   - 含汉字（Unicode Script=Han）即视为用户可见文案。
 *   - 允许文件（见 LOCALE_OWNER_PATTERNS）可以随便写中文，它们就是词典。
 *   - 其余文件命中即违规，除非该条目已在基线里。
 *
 * 用法：
 *   pnpm audit:ui-i18n                     # 门禁（基线之外的新增即 exit 1）
 *   tsx scripts/dev/check-ui-i18n.ts --report          # 只列全部违规，不看基线
 *   tsx scripts/dev/check-ui-i18n.ts --write-baseline  # 重录基线
 *   tsx scripts/dev/check-ui-i18n.ts --files a.ts b.ts # 只扫指定文件（pre-commit 用）
 */

import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 基线文件（棘轮：存量记在这里，新增一律报错）。 */
export const BASELINE_PATH = "scripts/dev/ui-i18n-baseline.json";

/**
 * 扫描器失效保险丝。产品源文件数量骤降（glob 写错 / 目录改名）时宁可报错也不要
 * 静悄悄地「零违规通过」。数值取当前实际值的约 8 成。
 */
export const MINIMUM_SOURCES = 480;

/** 允许文件（词典）数量下限，同上：允许列表失效会让门禁把词典本身当违规。 */
export const MINIMUM_LOCALE_OWNER_SOURCES = 8;

/**
 * 产品代码 glob。只扫 apps/*​/src 与 packages/*​/src，
 * scripts / reports / docs / .agents / node_modules / reference / .claude 天然在外。
 */
const SOURCE_GLOBS = ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"];

/** 不是产品运行时代码：测试、类型声明、夹具、QA 脚本、生成的期望值。 */
const EXCLUDED_SUFFIXES = [".test.ts", ".d.ts"];
const EXCLUDED_SEGMENTS = ["/expected/", "/fixtures/", "/__fixtures__/", "/qa/", "/node_modules/"];

/**
 * 允许拥有中文文案的文件模式（按 basename 或路径片段判定）。
 * 新代码请用 per-package 的小 `locales.ts`：中文对象是 key 集事实源，
 * 英文对象用 `satisfies Record<keyof typeof zh, string>` 做编译期对齐。
 */
const LOCALE_OWNER_PATTERNS: ReadonlyArray<{ test: (file: string, base: string) => boolean; label: string }> = [
  { label: "i18n*.ts", test: (_file, base) => /^i18n[\w.-]*\.ts$/.test(base) },
  { label: "locale*.ts / locales*.ts", test: (_file, base) => /^locales?[\w.-]*\.ts$/.test(base) },
  { label: "locales/** 目录", test: (file) => file.includes("/locales/") },
  { label: "*-copy.ts", test: (_file, base) => /-copy\.ts$/.test(base) }
];

/** 汉字判据。标点/全角符号不单独构成文案，必须至少有一个汉字。 */
const HAN = /\p{Script=Han}/u;

/**
 * 行内豁免标记（与 check-copy-terms.ts 的 `term-allow` 同一套约定）。
 * 用于本来就不是用户可见文案的中文串——LLM 提示词、写给日志的中文、迁移脚本的注记等。
 * 加豁免时请在同一行写清理由。
 */
const ALLOW_MARKER = "ui-i18n-allow";

/** 一处硬编码文案。 */
export interface UiI18nViolation {
  /** 仓库相对路径（POSIX 分隔符）。 */
  file: string;
  /** 一基行号（仅用于人读，基线不按行号记）。 */
  line: number;
  /** 一基列号。 */
  column: number;
  /** 归一化后的文案片段（基线比对用的键）。 */
  text: string;
  /** 命中的语法形态，便于人读。 */
  kind: string;
}

/** 基线文件结构：文件 → 归一化片段 → 允许出现次数。 */
export interface UiI18nBaseline {
  note: string;
  entries: Record<string, Record<string, number>>;
}

/**
 * 归一化片段：剥控制字符 + 折叠空白 + 截断，故基线不随行号/缩进漂移。
 * 控制字符要剥，是因为 TypeScript 给模板字面量的 `.text` 会带内部标记字符，
 * 留在基线里会变成既不可读也不可手改的键。
 */
export function normalizeSnippet(text: string): string {
  const collapsed = text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed.length <= 80 ? collapsed : `${collapsed.slice(0, 77)}...`;
}

/** 该文件是否是词典（允许拥有中文文案）。 */
export function isLocaleOwnerFile(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return LOCALE_OWNER_PATTERNS.some((pattern) => pattern.test(normalized, base));
}

/**
 * 这条仓库相对路径是否属于扫描范围。
 * 与 SOURCE_GLOBS 同义，但不走文件系统——`--files` 局部模式据此免掉全量 glob。
 */
export function isProductSourcePath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  if (!/^(?:apps|packages)\/[^/]+\/src\/.+\.ts$/.test(normalized)) return false;
  if (EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;
  return !EXCLUDED_SEGMENTS.some((segment) => `/${normalized}`.includes(segment));
}

/** 发现产品源文件（仓库相对、POSIX 分隔、已排序去重）。 */
export function discoverProductSources(root: string = ROOT): string[] {
  const found = SOURCE_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: root }));
  return [...new Set(found.map((file) => file.replaceAll("\\", "/")))].filter(isProductSourcePath).sort();
}

/**
 * 收集一个文件里全部含汉字的字面量——不看允许列表、不看行内豁免。
 * 门禁走 findCjkCopyLiterals；禁词门走这一个（词典文件本身也要扫禁词）。
 * @param file 仓库相对路径，只用于诊断输出。
 * @param sourceText TypeScript 源码。
 * @returns 按源码顺序排列的字面量。
 */
export function collectCjkLiterals(file: string, sourceText: string): UiI18nViolation[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<number, UiI18nViolation>();

  const report = (node: ts.Node, text: string, kind: string): void => {
    if (!HAN.test(text)) return;
    const start = node.getStart(source);
    if (found.has(start)) return;
    const position = source.getLineAndCharacterOfPosition(start);
    found.set(start, {
      file,
      line: position.line + 1,
      column: position.character + 1,
      text: normalizeSnippet(text),
      kind
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      // 对象/属性的字面量 key 是标识符不是文案（`{ "已完成": 1 }` 这种在本仓不存在，
      // 真出现了也该由 key 的作者改成 ASCII，故仍然报）。
      report(node, node.text, "字符串字面量");
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node, node.text, "模板字面量");
    } else if (ts.isTemplateExpression(node)) {
      report(
        node,
        [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(""),
        "带插值的模板字面量"
      );
    } else if (ts.isJsxText(node)) {
      report(node, node.text, "JSX 文本");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found.values()].sort((left, right) => left.line - right.line || left.column - right.column);
}

/**
 * 扫一个文件里写死的用户可见文案。
 * @param file 仓库相对路径，只用于诊断输出。
 * @param sourceText TypeScript 源码。
 * @returns 按源码顺序排列的违规；词典文件恒为空，带行内豁免的行不计。
 */
export function findCjkCopyLiterals(file: string, sourceText: string): UiI18nViolation[] {
  if (isLocaleOwnerFile(file)) return [];
  const allowedLines = new Set<number>();
  sourceText.split("\n").forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) allowedLines.add(index + 1);
  });
  return collectCjkLiterals(file, sourceText).filter((literal) => !allowedLines.has(literal.line));
}

/** 读任一棘轮基线文件；不存在或读不动时返回空基线。 */
export function loadBaselineFile(relativePath: string, root: string = ROOT): UiI18nBaseline {
  try {
    const raw = readFileSync(path.join(root, relativePath), "utf8");
    const parsed = JSON.parse(raw) as Partial<UiI18nBaseline>;
    return { note: parsed.note ?? "", entries: parsed.entries ?? {} };
  } catch {
    return { note: "", entries: {} };
  }
}

/** 读本门禁的基线。 */
export function loadBaseline(root: string = ROOT): UiI18nBaseline {
  return loadBaselineFile(BASELINE_PATH, root);
}

/** 基线比对结果。 */
export interface BaselineDiff {
  /** 基线之外的新增违规（门禁失败的原因）。 */
  added: UiI18nViolation[];
  /** 基线里已经不存在的条目（提示删除，不阻断）。 */
  stale: Array<{ file: string; text: string; remaining: number }>;
}

/** 把实测违规与基线对齐。 */
export function diffAgainstBaseline(
  violations: readonly UiI18nViolation[],
  baseline: UiI18nBaseline,
  scannedFiles?: ReadonlySet<string>
): BaselineDiff {
  const budget = new Map<string, Map<string, number>>();
  for (const [file, texts] of Object.entries(baseline.entries)) {
    budget.set(file, new Map(Object.entries(texts)));
  }
  const added: UiI18nViolation[] = [];
  for (const violation of violations) {
    const perFile = budget.get(violation.file);
    const remaining = perFile?.get(violation.text) ?? 0;
    if (remaining > 0) {
      perFile?.set(violation.text, remaining - 1);
      continue;
    }
    added.push(violation);
  }
  const stale: BaselineDiff["stale"] = [];
  for (const [file, texts] of budget) {
    // 只对本次真的扫过的文件判定「基线条目已消失」；--files 局部扫描不该误报。
    if (scannedFiles !== undefined && !scannedFiles.has(file)) continue;
    for (const [text, remaining] of texts) {
      if (remaining > 0) stale.push({ file, text, remaining });
    }
  }
  stale.sort((left, right) => left.file.localeCompare(right.file) || left.text.localeCompare(right.text));
  return { added, stale };
}

/** 由实测违规生成基线内容。 */
export function buildBaseline(violations: readonly UiI18nViolation[]): UiI18nBaseline {
  const entries: Record<string, Record<string, number>> = {};
  for (const violation of violations) {
    const perFile = (entries[violation.file] ??= {});
    perFile[violation.text] = (perFile[violation.text] ?? 0) + 1;
  }
  const sortedFiles = Object.keys(entries).sort();
  const sorted: Record<string, Record<string, number>> = {};
  for (const file of sortedFiles) {
    const texts = entries[file] ?? {};
    sorted[file] = Object.fromEntries(Object.keys(texts).sort().map((text) => [text, texts[text] as number]));
  }
  return {
    note:
      "存量硬编码文案棘轮基线（scripts/dev/check-ui-i18n.ts）。按「文件 + 归一化片段 → 次数」记录，" +
      "不按行号，故重排代码不会假红。迁走一条就从这里删一条；`--write-baseline` 可整体重录。" +
      "新增条目请不要往这里加——把文案搬进该包的 locales.ts。",
    entries: sorted
  };
}

/**
 * 禁词门的扫描目标：全部词典文件 + 基线里仍然含文案的文件。
 * 与 check-copy-terms.ts 共用同一份发现逻辑，避免两份文件清单各自漂移。
 */
export function copyTermScanTargets(root: string = ROOT): string[] {
  const sources = discoverProductSources(root);
  const dictionaries = sources.filter((file) => isLocaleOwnerFile(file));
  const baselineFiles = Object.keys(loadBaseline(root).entries);
  return [...new Set([...dictionaries, ...baselineFiles])].sort();
}

function relativize(input: string, root: string): string {
  const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  return path.relative(root, absolute).replaceAll("\\", "/");
}

function main(argv: readonly string[]): number {
  const reportOnly = argv.includes("--report");
  const writeBaseline = argv.includes("--write-baseline");
  const filesFlag = argv.indexOf("--files");
  const explicitFiles =
    filesFlag < 0 ? undefined : argv.slice(filesFlag + 1).filter((value) => !value.startsWith("--"));

  // `--files` 走路径谓词而不是全量 glob：pre-commit 要在 2 秒内跑完，遍历 587 个源文件太慢。
  const allSources = explicitFiles === undefined ? discoverProductSources() : [];
  if (explicitFiles === undefined) {
    if (allSources.length < MINIMUM_SOURCES) {
      console.error(
        `文案 locale 独占门禁：只发现 ${allSources.length} 个产品源文件，低于下限 ${MINIMUM_SOURCES}——` +
          "扫描范围疑似失效（glob 写错或目录改名），拒绝以「零违规」通过。"
      );
      return 1;
    }
    const owners = allSources.filter((file) => isLocaleOwnerFile(file));
    if (owners.length < MINIMUM_LOCALE_OWNER_SOURCES) {
      console.error(
        `文案 locale 独占门禁：只发现 ${owners.length} 个词典文件，低于下限 ${MINIMUM_LOCALE_OWNER_SOURCES}——` +
          "允许列表疑似失效。"
      );
      return 1;
    }
  }

  const targets =
    explicitFiles === undefined
      ? allSources
      : [...new Set(explicitFiles.map((file) => relativize(file, ROOT)).filter(isProductSourcePath))].sort();
  if (explicitFiles !== undefined && targets.length === 0) {
    console.log("文案 locale 独占门禁：本次没有需要检查的产品源文件");
    return 0;
  }

  const violations = targets.flatMap((file) => {
    let text: string;
    try {
      text = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      // 暂存的删除：文件已不在工作树上，没有可扫的内容。
      return [];
    }
    return findCjkCopyLiterals(file, text);
  });

  if (writeBaseline) {
    if (explicitFiles !== undefined) {
      console.error("文案 locale 独占门禁：--write-baseline 需要全量扫描，不能与 --files 同用");
      return 1;
    }
    writeFileSync(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(buildBaseline(violations), null, 2)}\n`, "utf8");
    console.log(`文案 locale 独占门禁：已重录基线 ${BASELINE_PATH}（${violations.length} 处，${
      new Set(violations.map((violation) => violation.file)).size
    } 个文件）`);
    return 0;
  }

  if (reportOnly) {
    console.log(`文案 locale 独占门禁（--report）：${violations.length} 处硬编码文案，按文件计：`);
    const perFile = new Map<string, number>();
    for (const violation of violations) perFile.set(violation.file, (perFile.get(violation.file) ?? 0) + 1);
    for (const [file, count] of [...perFile].sort((left, right) => right[1] - left[1])) {
      console.log(`  ${String(count).padStart(4)}  ${file}`);
    }
    return 0;
  }

  const { added, stale } = diffAgainstBaseline(violations, loadBaseline(), new Set(targets));
  for (const entry of stale) {
    console.warn(
      `文案 locale 独占门禁：基线条目已消失（请从 ${BASELINE_PATH} 删除）：${entry.file} × ${entry.remaining} —— ${entry.text}`
    );
  }
  if (added.length > 0) {
    console.error(
      `文案 locale 独占门禁：${added.length} 处中文文案写在非词典文件里（用户可见文案由 locale 独占）：`
    );
    for (const violation of added.slice(0, 60)) {
      console.error(
        `  ${violation.file}:${violation.line}:${violation.column} ${violation.kind}: ${JSON.stringify(violation.text)}`
      );
    }
    if (added.length > 60) console.error(`  …另有 ${added.length - 60} 处`);
    console.error(
      "修法：把这句话搬进该包的 locales.ts（中文对象是 key 集事实源，英文对象 satisfies 对齐），" +
        "调用点改成读词典。允许拥有中文的文件名：i18n*.ts / locale*.ts / locales/** / *-copy.ts。"
    );
    return 1;
  }
  console.log(
    `文案 locale 独占门禁通过：扫描 ${targets.length} 个产品源文件，基线内 ${violations.length} 处待迁移。`
  );
  return 0;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}
