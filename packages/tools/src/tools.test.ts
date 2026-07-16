import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSkillTool,
  formatSkillCatalog,
  listSkills,
  skillCatalogForPrompt, createBuiltInFileTools, createToolRegistry, ensureCommandAllowed, safeResolvePath } from "./index.js";

async function tempWorkdir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-tools-"));
}

test("safeResolvePath rejects path escapes", async () => {
  const workdir = await tempWorkdir();
  assert.throws(() => safeResolvePath(workdir, "../outside.txt"), /path escapes workdir/);
});

test("dependency install commands are disabled", () => {
  assert.throws(() => ensureCommandAllowed(["npm", "install"]), /disabled/);
  assert.throws(() => ensureCommandAllowed(["pnpm", "add", "left-pad"]), /disabled/);
  assert.doesNotThrow(() => ensureCommandAllowed(["node", "--version"]));
});

test("path-bearing command names are rejected (allowlist-bypass guard)", () => {
  // 白名单按 basename 校验、spawn 按原样执行 → 带路径的命令必须拒绝，否则 ./python 可绕过跑任意代码。
  assert.throws(() => ensureCommandAllowed(["./python"]), /bare allowlisted name/);
  assert.throws(() => ensureCommandAllowed(["../python"]), /bare allowlisted name/);
  assert.throws(() => ensureCommandAllowed(["evil/node"]), /bare allowlisted name/);
  assert.throws(() => ensureCommandAllowed(["/usr/bin/python"]), /bare allowlisted name/);
  assert.doesNotThrow(() => ensureCommandAllowed(["python3", "-c", "print(1)"]));
});

test("remote package execution (exec/dlx/x) is disabled", () => {
  assert.throws(() => ensureCommandAllowed(["npm", "exec", "cowsay"]), /disabled/);
  assert.throws(() => ensureCommandAllowed(["pnpm", "dlx", "cowsay"]), /disabled/);
  assert.throws(() => ensureCommandAllowed(["bun", "x", "cowsay"]), /disabled/);
});

test("safeResolvePath rejects symlink escapes via realpath containment", async () => {
  const wd = await mkdtemp(path.join(os.tmpdir(), "wh-sbx-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "wh-out-"));
  try {
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "top secret");
    await symlink(secret, path.join(wd, "link.txt"));
    // 沙箱内一个指向外部的 symlink：词法检查放行，realpath 守卫必须拦下。
    assert.throws(() => safeResolvePath(wd, "link.txt"), /symlink/);
    // 沙箱内尚不存在的新文件仍可解析（写入路径）。
    assert.doesNotThrow(() => safeResolvePath(wd, "new-output.txt"));
  } finally {
    await rm(wd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("side-effect tools fail closed without a snapshot hook", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute("write_file", { path: "outputs/a.txt", content: "hello" }, { workdir });

  assert.equal(result.ok, false);
  assert.match(result.content, /requires a snapshot gate/);
});

test("write_file executes only after snapshot succeeds", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute(
    "write_file",
    { path: "outputs/a.txt", content: "hello" },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-000000000001" })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.snapshotId, "30000000-0000-4000-8000-000000000001");
  assert.equal(await readFile(path.join(workdir, "outputs", "a.txt"), "utf8"), "hello");
});

test("write_file rejects an over-budget payload before it touches disk", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const oversized = "x".repeat(64);
  const result = await registry.execute(
    "write_file",
    { path: "outputs/big.txt", content: oversized },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-000000000099" }),
      sandboxBudget: { maxFiles: 100, maxBytes: 16, commandTimeoutSeconds: 5 }
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.content, /byte budget exceeded/);
  // 预检的关键：文件根本没被写出去（不是写完再报错）。
  await assert.rejects(readFile(path.join(workdir, "outputs", "big.txt"), "utf8"));
});

test("read_file truncates files larger than the read cap", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "inputs"), { recursive: true });
  // 3MB > 2MB cap：必须截断，不能整个塞回 tool-result。
  const big = "x".repeat(3 * 1024 * 1024);
  await writeFile(path.join(workdir, "inputs", "huge.txt"), big, "utf8");
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute("read_file", { path: "inputs/huge.txt" }, { workdir });

  assert.equal(result.ok, true);
  assert.match(result.content, /\[truncated/);
  // 返回内容远小于原文件（截到 ~2MB + 标记），不是 3MB 全量。
  assert.equal(result.content.length < 3 * 1024 * 1024, true);
});

test("findings: read_file truncation does not split a multibyte char into U+FFFD", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "inputs"), { recursive: true });
  // 让 'é'（0xC3 0xA9，2 字节）正好骑在 2MB cap 边界上：前 2MB-1 个 'x' + 'é' + 填充。
  // cap 读到的最后一个字节是 0xC3（lead byte），其续字节 0xA9 在 cap 之外。
  const PAD = 2 * 1024 * 1024 - 1;
  const content = "x".repeat(PAD) + "é" + "y".repeat(1024 * 1024);
  await writeFile(path.join(workdir, "inputs", "boundary.txt"), content, "utf8");
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute("read_file", { path: "inputs/boundary.txt" }, { workdir });

  assert.equal(result.ok, true);
  assert.match(result.content, /\[truncated/);
  // 不能出现替换字符——半个 'é' 应被干净丢弃，而不是解成 。
  assert.equal(result.content.includes("�"), false);
});

test("read_file returns small files whole", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "inputs"), { recursive: true });
  await writeFile(path.join(workdir, "inputs", "small.txt"), "hello world", "utf8");
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute("read_file", { path: "inputs/small.txt" }, { workdir });

  assert.equal(result.ok, true);
  assert.equal(result.content, "hello world");
});

test("run_command fails closed when no sandboxed command runner is configured", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute(
    "run_command",
    { args: ["python3", "-c", "print('hi')"], cwd: "." },
    {
      workdir,
      // 给足 snapshot gate，确保拦截的是「没有受控 runner」这道关，而不是快照关。
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-0000000000aa" })
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.content, /run_command 已禁用|commandRunner/);
});

test("run_command runs through an injected command runner (opt-in)", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  let received: string[] | undefined;
  const result = await registry.execute(
    "run_command",
    { args: ["python3", "-c", "print('hi')"], cwd: "." },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-0000000000ab" }),
      // 显式注入的受控 runner（这里用桩，不真起进程）：fail-closed 关被 opt-in 放开。
      commandRunner: async ({ args }) => {
        received = args;
        return { exitCode: 0, stdout: "stub-ok", stderr: "" };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /stub-ok/);
  assert.deepEqual(received, ["python3", "-c", "print('hi')"]);
});

test("read_file can infer the only input file when providers send a description", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "inputs"), { recursive: true });
  await writeFile(path.join(workdir, "inputs", "meeting-notes.md"), "one input", "utf8");
  const registry = createToolRegistry(createBuiltInFileTools());

  const result = await registry.execute("read_file", { description: "Read the meeting notes" }, { workdir });

  assert.equal(result.ok, true);
  assert.equal(result.content, "one input");
});

test("toModelTools exposes concrete JSON schema for provider tool calling", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const tools = await registry.toModelTools({ workdir });
  const writeFile = tools.find((tool) => tool.name === "write_file") as
    | { input_schema?: { properties?: Record<string, unknown>; required?: string[] } }
    | undefined;

  assert.ok(writeFile);
  assert.ok(writeFile.input_schema?.properties?.["path"]);
  assert.ok(writeFile.input_schema?.properties?.["content"]);
  assert.deepEqual(writeFile.input_schema?.required?.sort(), ["content", "path"]);
});

test("promptReference collects snippets/guidelines separately from the model description channel", () => {
  const registry = createToolRegistry([...createBuiltInFileTools(), createSkillTool()]);
  const reference = registry.promptReference();

  // 有 promptSnippet 的工具进「可用工具」清单；submit 故意不设 snippet → 不在清单里。
  const snippetIds = reference.snippets.map((entry) => entry.id);
  assert.equal(snippetIds.includes("read_file"), true);
  assert.equal(snippetIds.includes("write_file"), true);
  assert.equal(snippetIds.includes("run_command"), true);
  assert.equal(snippetIds.includes("load_skill"), true);
  assert.equal(snippetIds.includes("submit"), false);
  // snippet 是一行能力广告，不等于喂给模型的完整 description。
  const readSnippet = reference.snippets.find((entry) => entry.id === "read_file");
  assert.equal(readSnippet?.snippet, "Read a UTF-8 text file from the sandbox");

  // guidelines 点名具体工具、且跨工具 Set 去重（无重复条目）。
  assert.equal(reference.guidelines.length, new Set(reference.guidelines).size);
  assert.equal(reference.guidelines.some((line) => line.includes("read_file")), true);
  assert.equal(reference.guidelines.some((line) => line.includes("run_command")), true);
  // 不许出现无主语的「this tool」占位式准则。
  assert.equal(reference.guidelines.some((line) => /this tool/iu.test(line)), false);

  // description 通道保持独立且完整（内联了截断续读说明），不被 snippet 取代。
  const readSpec = registry.get("read_file");
  assert.notEqual(readSpec?.description, readSnippet?.snippet);
  assert.equal(readSpec?.description.includes("[truncated]"), true);
});

test("zip_path writes a real zip archive after snapshot succeeds", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "outputs", "bundle"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "bundle", "a.txt"), "alpha", "utf8");
  await mkdir(path.join(workdir, "outputs", "bundle", "nested"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "bundle", "nested", "b.txt"), "beta", "utf8");

  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute(
    "zip_path",
    { src: "outputs/bundle", dest: "outputs/bundle.zip" },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-000000000002" })
    }
  );

  const archive = await readFile(path.join(workdir, "outputs", "bundle.zip"));
  assert.equal(result.ok, true);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.includes(Buffer.from("a.txt", "utf8")), true);
  assert.equal(archive.includes(Buffer.from("nested/b.txt", "utf8")), true);
  assert.equal(archive.includes(Buffer.from("archive_manifest", "utf8")), false);
});

test("skill registry lists the seven preset skills with frontmatter", () => {
  const skills = listSkills();
  assert.deepEqual(skills.map((skill) => skill.id), [
    "code-script",
    "data-analysis",
    "docx-document",
    "markdown-report",
    "pptx-deck",
    "stat-charts",
    "xlsx-spreadsheet"
  ]);
  for (const skill of skills) {
    assert.equal(skill.name, skill.id);
    assert.equal(skill.description.length > 10, true);
    assert.equal(skill.whenToUse.length > 5, true);
  }
  const catalog = skillCatalogForPrompt();
  assert.equal(catalog.split("\n").length, 7);
  assert.equal(catalog.includes("docx-document"), true);
});

test("load_skill serves injected team skills (FS-first, team fallback) and lists both on miss", async () => {
  const ctx = { workdir: "/tmp" };
  const teamContent = { "quarterly-report": "---\nname: 季度报告\nwhen_to_use: 季报\n---\n\n# 季度报告" };
  const tool = createSkillTool(undefined, teamContent);

  // FS 预设仍优先命中。
  const fs = await tool.execute({ id: "docx-document" }, ctx);
  assert.equal(fs.content.includes("from docx import Document"), true);

  // 团队技能可被加载。
  const team = await tool.execute({ id: "quarterly-report" }, ctx);
  assert.equal(team.ok, true);
  assert.equal(team.content.includes("季度报告"), true);

  // 未知 id 的报错把 FS + 团队技能都列出来。
  const unknown = await tool.execute({ id: "no-such-skill" }, ctx);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.content.includes("quarterly-report"), true);
  assert.equal(unknown.content.includes("docx-document"), true);
});

test("formatSkillCatalog renders id：whenToUse lines", () => {
  const catalog = formatSkillCatalog([
    { id: "a-skill", name: "A", description: "desc", whenToUse: "用 A 的时候" }
  ]);
  assert.equal(catalog, "- a-skill：用 A 的时候");
});

test("load_skill returns skill content and fails closed on unknown ids", async () => {
  const tool = createSkillTool();
  const ctx = { workdir: "/tmp" };

  const loaded = await tool.execute({ id: "stat-charts" }, ctx);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.content.includes("matplotlib.use(\"Agg\")"), true);
  assert.equal(loaded.content.includes("Noto Sans CJK"), true);

  const docx = await tool.execute({ id: "docx-document" }, ctx);
  assert.equal(docx.content.includes("from docx import Document"), true);

  const unknown = await tool.execute({ id: "no-such-skill" }, ctx);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.isError, true);
  assert.equal(unknown.content.includes("docx-document"), true);

  const traversal = await tool.execute({ id: "../secrets" }, ctx);
  assert.equal(traversal.ok, false);
});
