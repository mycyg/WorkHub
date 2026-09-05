import assert from "node:assert/strict";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBuiltInFileTools } from "./file-tools.js";
import { createToolRegistry } from "./registry.js";
import { createSandboxedCommandRunner, runSandboxedCommand } from "./sandbox.js";
import {
  SANDBOX_EXEC_PATH,
  SANDBOX_UNAVAILABLE,
  buildSeatbeltProfile,
  detectSandboxDenial,
  detectSeatbeltRunnerFailure,
  interpreterReadRoot,
  pathAliases,
  resolveSandboxBackend,
  sandboxDenialNotice,
  sbplString,
  seatbeltArgv,
  writableRoots
} from "./seatbelt.js";

async function tempWorkdir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-seatbelt-"));
}

/**
 * 集成用例专用执行器：把「宿主临时目录」钉死在 workdir 内部，写白名单才是确定的
 * （否则 os.tmpdir() 本身可写，逃逸断言会因为逃逸目标恰好落在临时目录里而假绿）。
 */
function pinnedRunner(workdir: string) {
  return createSandboxedCommandRunner({ hostTempDir: path.join(workdir, ".host-temp") });
}

/** 一个确定落在写白名单之外的逃逸目标。 */
function escapePath(tag: string) {
  return path.join("/private/tmp", `workhub-seatbelt-${tag}-${process.pid}.txt`);
}

// ---------------------------------------------------------------------------
// profile 生成
// ---------------------------------------------------------------------------

test("profile 以 (deny default) 起手并显式拒网", () => {
  const profile = buildSeatbeltProfile({ mode: "workspace-write", workdir: "/private/tmp/wh-x" });
  const lines = profile.split("\n").filter((line) => !line.startsWith(";;"));
  assert.equal(lines[0], "(version 1)");
  assert.equal(lines[1], "(deny default)");
  assert.equal(lines[2], "(deny network*)");
  assert.equal(profile.includes("(allow default)"), false);
});

test("workspace-write 只把工作目录与本进程临时目录放进写白名单", () => {
  const profile = buildSeatbeltProfile({
    mode: "workspace-write",
    workdir: "/private/tmp/wh-x",
    hostTempDir: "/private/var/folders/ab/cd/T"
  });
  const writeLine = profile.split("\n").find((line) => line.startsWith("(allow file-write* ")) ?? "";
  assert.equal(writeLine.includes('(subpath "/private/tmp/wh-x")'), true);
  assert.equal(writeLine.includes('(subpath "/private/var/folders/ab/cd/T")'), true);
  // 宿主家目录、系统目录一律不在写白名单里。
  assert.equal(writeLine.includes('(subpath "/Users")'), false);
  assert.equal(writeLine.includes('(subpath "/usr")'), false);
  assert.equal(writeLine.includes('(subpath "/")'), false);
});

test("read-only 一条写白名单都不给（连工作目录也没有）", () => {
  const profile = buildSeatbeltProfile({ mode: "read-only", workdir: "/private/tmp/wh-x" });
  assert.equal(profile.split("\n").some((line) => line.startsWith("(allow file-write* ")), false);
  // 但工作目录仍然可读，否则命令连输入材料都读不到。
  assert.equal(profile.includes('(allow file-read* '), true);
  assert.equal(profile.includes('(subpath "/private/tmp/wh-x")'), true);
});

test("writableRoots：read-only 为空，workspace-write 去重且不含根目录", () => {
  assert.deepEqual(writableRoots({ mode: "read-only", workdir: "/private/tmp/wh-x" }), []);
  assert.deepEqual(
    writableRoots({ mode: "workspace-write", workdir: "/private/tmp/wh-x", hostTempDir: "/private/tmp/wh-x/" }),
    ["/private/tmp/wh-x"]
  );
  assert.deepEqual(writableRoots({ mode: "workspace-write", workdir: "/", hostTempDir: "/" }), []);
});

test("SBPL 字符串转义：带引号/反斜杠的工作目录不能注入 profile", () => {
  assert.equal(sbplString('/tmp/a"b'), '"/tmp/a\\"b"');
  assert.equal(sbplString("/tmp/a\\b"), '"/tmp/a\\\\b"');
  // 逃逸载荷里的引号必须被转义掉，`(allow default)` 只能作为字符串内容出现、绝不能成为一条指令。
  const profile = buildSeatbeltProfile({ mode: "workspace-write", workdir: '/private/tmp/a") (allow default) ("' });
  assert.equal(profile.includes('") (allow default) ("'), false);
  assert.equal(profile.includes('\\") (allow default) (\\"'), true);
});

test("pathAliases 同时给出 /var 与 /private/var 两种拼法", () => {
  assert.deepEqual(pathAliases("/private/var/folders/x/T").sort(), ["/private/var/folders/x/T", "/var/folders/x/T"]);
  assert.deepEqual(pathAliases("/tmp/x").sort(), ["/private/tmp/x", "/tmp/x"]);
  assert.deepEqual(pathAliases("/opt/homebrew"), ["/opt/homebrew"]);
});

test("interpreterReadRoot 取解释器的安装前缀，且绝不退化成根目录", () => {
  assert.equal(interpreterReadRoot("/opt/whatever/node22/bin/node"), "/opt/whatever/node22");
  assert.equal(interpreterReadRoot("/opt/whatever/python3"), "/opt/whatever");
  // /bin/sh → 前缀会是 "/"，必须拒绝（否则等于放弃整个只读围栏）。
  assert.equal(interpreterReadRoot("/bin/sh"), undefined);
  assert.equal(interpreterReadRoot("node"), undefined);
});

test("seatbeltArgv 把命令包成 sandbox-exec -p '<profile>' -- <argv>", () => {
  const argv = seatbeltArgv({ args: ["python3", "-c", "print(1)"], profile: "(version 1)", sandboxExecPath: "/x/sandbox-exec" });
  assert.deepEqual(argv, ["/x/sandbox-exec", "-p", "(version 1)", "--", "python3", "-c", "print(1)"]);
});

// ---------------------------------------------------------------------------
// fail-closed 决策矩阵（平台 × 开关 × 模式）
// ---------------------------------------------------------------------------

test("fail-closed 决策矩阵", () => {
  const matrix: Array<{
    platform: string;
    seatbeltAvailable: boolean;
    allowDegraded: boolean;
    mode: "read-only" | "workspace-write" | "danger-full-access";
    expect: string;
  }> = [
    { platform: "darwin", seatbeltAvailable: true, allowDegraded: false, mode: "workspace-write", expect: "seatbelt/full" },
    { platform: "darwin", seatbeltAvailable: true, allowDegraded: true, mode: "workspace-write", expect: "seatbelt/full" },
    { platform: "darwin", seatbeltAvailable: true, allowDegraded: false, mode: "read-only", expect: "seatbelt/full" },
    // macOS 但拿不到 sandbox-exec（被裁剪/权限异常）：不许静默降级。
    { platform: "darwin", seatbeltAvailable: false, allowDegraded: false, mode: "workspace-write", expect: "unavailable" },
    { platform: "darwin", seatbeltAvailable: false, allowDegraded: true, mode: "workspace-write", expect: "soft/partial" },
    { platform: "linux", seatbeltAvailable: false, allowDegraded: false, mode: "workspace-write", expect: "unavailable" },
    { platform: "linux", seatbeltAvailable: false, allowDegraded: false, mode: "read-only", expect: "unavailable" },
    { platform: "linux", seatbeltAvailable: false, allowDegraded: true, mode: "workspace-write", expect: "soft/partial" },
    { platform: "win32", seatbeltAvailable: false, allowDegraded: false, mode: "workspace-write", expect: "unavailable" },
    { platform: "win32", seatbeltAvailable: false, allowDegraded: true, mode: "read-only", expect: "soft/partial" },
    // danger-full-access 是显式配置才取得到的一档：不包裹，且绝不上报 full。
    { platform: "darwin", seatbeltAvailable: true, allowDegraded: false, mode: "danger-full-access", expect: "danger-full-access/partial" },
    { platform: "linux", seatbeltAvailable: false, allowDegraded: false, mode: "danger-full-access", expect: "danger-full-access/partial" }
  ];
  for (const row of matrix) {
    const decision = resolveSandboxBackend(row);
    const actual = decision.backend === "unavailable" ? "unavailable" : `${decision.backend}/${decision.enforcement}`;
    assert.equal(actual, row.expect, `${row.platform}/${row.mode}/degraded=${row.allowDegraded}`);
    if (decision.backend === "unavailable") {
      assert.equal(decision.code, SANDBOX_UNAVAILABLE);
      assert.equal(decision.message.includes(row.platform), true);
    }
  }
});

test("没有后端且未允许降级时 runner 拒绝执行且命令根本没跑", async () => {
  const workdir = await tempWorkdir();
  const runner = createSandboxedCommandRunner({ platform: "linux", allowDegraded: false });
  const result = await runner({
    args: ["python3", "-c", "open('/private/tmp/wh-should-not-exist','w')"],
    cwd: workdir,
    workdir,
    timeoutSeconds: 5,
    env: {},
    mode: "workspace-write"
  });
  assert.equal(result.sandboxUnavailable, true);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stderr.includes(SANDBOX_UNAVAILABLE), true);
  assert.equal(result.enforcement, undefined);
  await rm(workdir, { recursive: true, force: true });
});

test("显式允许降级时走软沙箱并如实上报 partial", async () => {
  const workdir = await tempWorkdir();
  const runner = createSandboxedCommandRunner({ platform: "linux", allowDegraded: true });
  const result = await runner({
    args: [process.execPath, "-e", "console.log('degraded')"],
    cwd: workdir,
    workdir,
    timeoutSeconds: 20,
    env: { PATH: process.env.PATH ?? "" },
    mode: "workspace-write"
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "degraded");
  assert.equal(result.enforcement, "partial");
  assert.equal(result.backend, "soft");
  await rm(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 拒绝签名与话术
// ---------------------------------------------------------------------------

test("拒绝签名识别：文件与网络分开，成功的命令不误报", () => {
  assert.deepEqual(detectSandboxDenial({ stderr: "", exitCode: 0 }), { denied: false });
  assert.deepEqual(detectSandboxDenial({ stderr: "SyntaxError: invalid syntax", exitCode: 1 }), { denied: false });
  assert.deepEqual(
    detectSandboxDenial({ stderr: "PermissionError: [Errno 1] Operation not permitted: '/etc/x'", exitCode: 1 }),
    { denied: true, operation: "file access" }
  );
  assert.deepEqual(
    detectSandboxDenial({ stderr: "socket.create_connection ... [Errno 1] Operation not permitted", exitCode: 1 }),
    { denied: true, operation: "network" }
  );
  assert.deepEqual(
    detectSandboxDenial({ stderr: "Error: connect EPERM 1.1.1.1:80", exitCode: 1 }),
    { denied: true, operation: "network" }
  );
});

test("拒绝话术把「这是策略不是命令写错」说死", () => {
  for (const operation of ["file access", "network"] as const) {
    const notice = sandboxDenialNotice(operation);
    assert.equal(notice.startsWith(`[sandbox: ${operation} denied by policy] `), true);
    assert.equal(notice.includes("不是命令写错"), true);
    assert.equal(notice.includes("不要换写法绕过"), true);
    // 中英双语：英文半句也要在。
    assert.equal(notice.includes("The sandbox policy denied this"), true);
  }
});

test("包裹器自身故障与命令拼错要分开", () => {
  assert.deepEqual(detectSeatbeltRunnerFailure({ stderr: "Traceback ...", exitCode: 1 }), { failed: false });
  const profileFailure = detectSeatbeltRunnerFailure({ stderr: "sandbox-exec: syntax error: expecting ')'", exitCode: 65 });
  assert.equal(profileFailure.kind, "profile");
  const execFailure = detectSeatbeltRunnerFailure({
    stderr: "sandbox-exec: execvp() of '/no/such' failed: No such file or directory",
    exitCode: 71
  });
  assert.equal(execFailure.kind, "exec");
});

// ---------------------------------------------------------------------------
// 真 macOS 集成：拒绝路径必须可复现（a guard only guards if the regression fails it）
// ---------------------------------------------------------------------------

function seatbeltUsable() {
  if (process.platform !== "darwin") return false;
  try {
    accessSync(SANDBOX_EXEC_PATH, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const skipSeatbelt = !seatbeltUsable();

test("macOS Seatbelt：workdir 内写通过、workdir 外写被拒、网络被拒", { skip: skipSeatbelt }, async () => {
  const workdir = await tempWorkdir();
  const runner = pinnedRunner(workdir);
  const escapeTarget = escapePath("escape");
  try {
    const inside = await runSandboxedCommand({
      args: ["node", "-e", "require('node:fs').writeFileSync('inside.txt','ok'); console.log('inside ok')"],
      cwd: ".",
      workdir,
      timeoutSeconds: 30,
      mode: "workspace-write",
      runner
    });
    assert.equal(inside.exitCode, 0, inside.stderr);
    assert.equal(inside.enforcement, "full");
    assert.equal(inside.backend, "seatbelt");
    assert.equal(await readFile(path.join(workdir, "inside.txt"), "utf8"), "ok");

    const outside = await runSandboxedCommand({
      args: ["node", "-e", `require('node:fs').writeFileSync(${JSON.stringify(escapeTarget)},'escaped')`],
      cwd: ".",
      workdir,
      timeoutSeconds: 30,
      mode: "workspace-write",
      runner
    });
    assert.notEqual(outside.exitCode, 0);
    assert.equal(outside.sandboxDenied, true);
    assert.equal(outside.stderr.includes("[sandbox: file access denied by policy]"), true);
    await assert.rejects(readFile(escapeTarget), /ENOENT/u, "workdir 外的文件绝不能被写出来");

    const network = await runSandboxedCommand({
      args: [
        "node",
        "-e",
        "const s=require('node:net').connect(80,'1.1.1.1',()=>{console.log('NETWORK REACHED');process.exit(0)});s.on('error',e=>{console.error('connect '+e.code);process.exit(9)})"
      ],
      cwd: ".",
      workdir,
      timeoutSeconds: 30,
      mode: "workspace-write",
      runner
    });
    assert.equal(network.stdout.includes("NETWORK REACHED"), false, "出网必须被拒");
    assert.equal(network.sandboxDenied, true);
    assert.equal(network.stderr.includes("[sandbox: network denied by policy]"), true);
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(escapeTarget, { force: true });
  }
});

test("macOS Seatbelt：read-only 下连 workdir 内写也被拒", { skip: skipSeatbelt }, async () => {
  const workdir = await tempWorkdir();
  const runner = pinnedRunner(workdir);
  try {
    const readOnly = await runSandboxedCommand({
      args: ["node", "-e", "require('node:fs').writeFileSync('nope.txt','x'); console.log('WROTE')"],
      cwd: ".",
      workdir,
      timeoutSeconds: 30,
      mode: "read-only",
      runner
    });
    assert.equal(readOnly.stdout.includes("WROTE"), false);
    assert.notEqual(readOnly.exitCode, 0);
    assert.equal(readOnly.sandboxDenied, true);
    await assert.rejects(readFile(path.join(workdir, "nope.txt")), /ENOENT/u);

    // 同一档下读仍然通的，否则这条测试只证明了「命令跑不起来」。
    const read = await runSandboxedCommand({
      args: ["node", "-e", "console.log('read ok')"],
      cwd: ".",
      workdir,
      timeoutSeconds: 30,
      mode: "read-only",
      runner
    });
    assert.equal(read.exitCode, 0, read.stderr);
    assert.equal(read.stdout.trim(), "read ok");
    assert.equal(read.enforcement, "full");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("macOS Seatbelt：子进程继承同一条策略", { skip: skipSeatbelt }, async () => {
  const workdir = await tempWorkdir();
  const runner = pinnedRunner(workdir);
  const escapeTarget = escapePath("child");
  try {
    const result = await runSandboxedCommand({
      args: [
        "node",
        "-e",
        `const r=require('node:child_process').spawnSync(process.execPath,['-e','require("node:fs").writeFileSync(${JSON.stringify(escapeTarget)},"x")']);console.log('child status '+r.status)`
      ],
      cwd: ".",
      workdir,
      timeoutSeconds: 30,
      mode: "workspace-write",
      runner
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.includes("child status 0"), false, "子进程写 workdir 外必须失败");
    await assert.rejects(readFile(escapeTarget), /ENOENT/u);
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(escapeTarget, { force: true });
  }
});

// ---------------------------------------------------------------------------
// run_command 接线：模式与完整度要一路传到工具结果里
// ---------------------------------------------------------------------------

test("run_command 默认按 workspace-write 下发，并把执行完整度带回结果", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const seen: Array<{ mode: string | undefined; workdir: string | undefined }> = [];
  const result = await registry.execute(
    "run_command",
    { args: ["python3", "-c", "print('hi')"], cwd: "." },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-0000000000ac" }),
      commandRunner: async ({ mode, workdir: runnerWorkdir }) => {
        seen.push({ mode, workdir: runnerWorkdir });
        return { exitCode: 0, stdout: "ok", stderr: "", enforcement: "full", backend: "seatbelt" };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(seen[0]?.mode, "workspace-write");
  assert.equal(seen[0]?.workdir, path.resolve(workdir));
  assert.equal((result.data as { enforcement?: string } | undefined)?.enforcement, "full");
  await rm(workdir, { recursive: true, force: true });
});

test("run_command 按上下文下发 read-only 模式", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  let seenMode: string | undefined;
  await registry.execute(
    "run_command",
    { args: ["python3", "-c", "print('hi')"], cwd: "." },
    {
      workdir,
      sandboxMode: "read-only",
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-0000000000ad" }),
      commandRunner: async ({ mode }) => {
        seenMode = mode;
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    }
  );
  assert.equal(seenMode, "read-only");
  await rm(workdir, { recursive: true, force: true });
});
