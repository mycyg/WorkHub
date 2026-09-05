# 桌面端发布流水线（workflow + 版本单一事实源 + 文档）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R24-S2 B 线，侦察+设计见 scratchpad/r24-S2-release-pipeline.md）

## Problem

产品方向已拍板：桌面端是核心，要能打包分发给自托管用户。但仓库里没有任何东西能把
`client-tauri/` 编译成 macOS/Windows/Linux 三平台的可下载安装包——`cargo tauri build`
只有本地手动跑过（`scripts/dev/build-macos-app.sh`，且只覆盖 macOS），CI 从未跑过
`cargo tauri build`（打包）本身，Windows 编译面完全未验证过。版本号（根 package.json /
apps/desktop-webview/package.json / client-tauri 的 Cargo.toml 与 tauri.conf.json 四处）
只是碰巧都是 0.1.0，没有任何门禁挡住它们漂移。README/DEPLOY 也从没提过"桌面客户端"
这回事，用户拿到 Release 资产也不知道未签名安装包要怎么打开、不知道怎么把客户端指向
自己的服务器。

本批只做 W-1（落 workflow）+ W-3（版本单一事实源+门禁+发布脚本）+ W-4（验签脚本路径口）
+ W-5（文档）。B-1（CSP `connect-src` 只放行本机回环，导致打包后的客户端连不上远端
服务器）是产品级阻塞，明确留给另一条线；本轮不打 tag、不改当前版本号、不执行任何
workflow_dispatch/推送 tag——只把管线和工具准备好。

## Decision

**触发面只有 `v*` tag push 与 workflow_dispatch，没有 `push: branches` / `pull_request`**：
这是把这份 workflow 安全合进 `main` 的前提——GitHub 的规则是 `workflow_dispatch` 只有在
文件存在于默认分支才能被触发，`--ref` 只决定用哪个分支的文件执行，所以必须先合 main
才能干跑。选择"没有其它触发口"，意味着合入本身对现有 `verify.yml` 的 8 个 job 零影响，
不需要先在特性分支上反复验证到位才敢合——可以先合、后验。

**macOS 签名三档（adhoc/signed/notarized），而不是"有证书就必须公证"**：根据 tauri-bundler
2.9.3 源码核实的三条硬约束——(a) `tauri.conf.json` 写死 `signingIdentity: "-"`，真证书身份
串一旦不含 `-` 就会跟这个 ad-hoc 值校验冲突，必须用 `--config` 覆写；(b) hardened runtime
公证强制要求打开，仓库默认是 false；(c) `APPLE_ID`/`APPLE_PASSWORD` 给了但没给
`APPLE_TEAM_ID` 是硬失败（`MissingTeamId`），不是"跳过公证"。因此判定逻辑是：三件套证书
凭据都没有 → 完全不碰配置，走仓库默认的 ad-hoc（这是唯一能保证"没证书也能出可本机启动的
产物"的路径，完全不签名的 bundle 在 Apple Silicon 上会被 AMFI SIGKILL）；三件套证书有但
公证三件套不全 → 只覆写签名身份+hardened runtime，产出"签名但未公证"；两套都全 →
额外注入公证凭据。**签名/公证 secret 全部可选，这是用户已拍板的决策**——不买证书的路径
必须永远可用且产物结构完整。

**干跑（`dry_run` 默认 `true`）通过让 `tagName`/`releaseName` 为空字符串来实现"不碰
Release"**，不是通过跳过 tauri-action 整个 step——tauri-action 本身的语义是"tagName 空
则只构建+传 workflow artifacts"。这个"空字符串"必须在 `plan` job 里用 bash 的
`if/exit-code` 分支算好、作为独立 job output 直接传给 `bundle` job，**不能**用
GitHub 表达式的 `dry_run == 'true' && '' || tag` 内联三元写法——`&&`/`||` 是 JS 短路
语义，真分支的值是空字符串（falsy）时会被 `||` 悄悄换成假分支的值，导致"干跑却把
tagName 填成了真实 tag"。这是逐行复核时从设计稿草案里挑出来的一个真实 bug（草案本身
就是这么写的），修法记在 workflow 文件的注释里，避免以后有人"优化"回内联三元。

**macOS 验签门直接调用 `scripts/dev/build-macos-app.sh`，而不是在 workflow 里内联重复
一份 codesign/spctl 断言**：给脚本加了 `WORKHUB_MACOS_BUILD_APP_PATH` 覆盖口（外加
从脚本自身构建参数里解析 `--target` 的兜底），这样"验签逻辑"只有一份，`qa:desktop-macos-
codesign-smoke` 也从"写在 package.json 里但从没进过任何 CI job 的门禁"变成真正跑在
CI 上的门禁。脚本自己的 "OK" 提示语义不变（W-4 的约束），签名模式（adhoc/signed/
notarized）改成在 workflow 步骤里单独 echo 一行——不为了 CI 场景污染一个本机/CI 共用
脚本的输出措辞。

**版本号单一事实源 = 根 package.json**，`scripts/dev/sync-desktop-version.ts` 单向
传播到另外三处 + `Cargo.lock` 里 `workhub-client-tauri` crate 的版本行（这一处不计入
`check-desktop-version.ts` 的"四处"主报告，但同样校验——漂移会让 `--locked`/`--frozen`
构建失败，或者让一次普通 `cargo build` 悄悄改写 Cargo.lock）。写入一律用文本行级替换
而不是 JSON 整份重新序列化，理由是后者会按对象 key 顺序重新格式化整份文件，在 diff 里
制造版本号之外的噪音；已用隔离临时目录做过真实的 bump/幂等/故意改歪再修复的往返验证，
每次 diff 都只有版本号那一行。`release:desktop`（`scripts/dev/release-desktop.sh`）
校验语义化版本、工作树干净、当前在 `main`，调 sync 脚本、targeted `git add` 五个文件、
提交、打 annotated tag——**脚本本身不 push**，推送 tag 就是触发真发布，必须由人显式
执行；本批只写脚本，没有调用它（当前版本号仍是 0.1.0，未打任何 tag）。

**本轮不做自动更新（tauri-plugin-updater）**：(1) 仓库目前没装这个插件，接线涉及
Rust 依赖、`capabilities/default.json` 权限集合（`tauri_scaffold.rs` 精确断言了当前
权限集合，改了要同步改测试）、minisign 密钥对生成与离线备份；(2) 更新器在实践中和
"真 Developer ID 签名+公证"强绑定——ad-hoc 签名的应用做原地替换更新容易被 Gatekeeper
拦，没有真证书接更新器等于给用户一个用不了的功能；(3) Linux 端更新器只支持
AppImage，deb/rpm 装的用户拿不到；(4) 私钥丢失=所有已装客户端永久失去更新能力，这个
决策的严重性值得等"是否买 Apple 开发者账号"（用户还未拍板）之后再做，而不是现在顺手
搭个用不上的地基。`uploadUpdaterJson`/`uploadUpdaterSignatures` 在 workflow 里显式
留 `false`。

**CORS 文档补在 DEPLOY.md 而不是只写在 workflow/README 里**：生产环境 `CORS_ALLOW_
ORIGINS` 禁止 `*`（`packages/config/src/env.ts` 的 fail-closed 配置守卫），此时
`apps/api/src/app.ts` 里那段自动反射本机回环+桌面 tauri 来源的 `isDevReflectableOrigin`
逻辑完全不生效——`corsAllowOrigins` 变成精确字符串白名单，桌面客户端的来源必须
**显式**写进去。这是个"配置正确与否只有连不上时才会发现"的坑，且报错信息不会指向
CORS（客户端只看到笼统的网络错误），所以写成独立小节而不是一行提示，并把 macOS
（`tauri://localhost`）与 Windows（`http://tauri.localhost`）两种来源形态都列出来，
说明两条都写、不按用户系统挑一条也没有风险。同时如实标注：这只解决了 CORS 这一层，
CSP `connect-src` 仍只放行本机回环（B-1，另一条线处理）——服务器配好 CORS 之后，
远端连接在网络层依然不通，避免用户读了这节文档以为现在就能跨机器连。

## Alternatives considered

- **workflow 触发面加 `pull_request`（对着 PR 跑一次打包验证改动没搞炸构建）**：能更早
  发现问题，但打包一次要编译四份 Rust release 二进制，耗时/耗费 runner 分钟数与"发布
  管线"这个用途不成比例；且这条线本来就不改 client-tauri 的实质代码，不需要在每个 PR
  上跑。被否，留作以后如果 client-tauri 改动频繁再评估。
- **`tagName`/`releaseName` 的干跑判断改成在 bundle job 里用 `if:` 整体跳过 tauri-action
  这个 step**：能规避掉三元表达式的 bug，但会导致干跑完全不构建（干跑的价值恰恰是
  "验证四平台真的能编译打包出东西"），被否——问题出在"传给 action 的值"而不是"要不要
  跑这个 step"，修在 plan job 的 bash 里更对症。
- **`sync-desktop-version.ts` 用现成 TOML/JSON 解析库整份重写**：仓库没装任何 TOML
  解析库（`@iarna/toml`/`smol-toml` 均未安装），装新依赖不在本轮允许范围内；就算装了，
  JSON.stringify 整份重写也会引入 key 顺序/缩进噪音。改用文本行级替换，已用真实文件
  验证 diff 只有版本号那一行。
- **`build:desktop` 写成 `pnpm --filter @workhub/desktop-webview build && cargo tauri
  build`（先显式建前端再建 Rust）**：`tauri.conf.json` 的 `beforeBuildCommand` 本来就会
  再跑一遍这条 pnpm 命令，两者叠加等于本机每次都多等一次前端构建（CI 的矩阵 job 里
  这么做是为了让两类失败在日志里分开，几秒钟的代价在几十分钟的 Rust 编译面前可以忽略；
  但本地单命令构建脚本没有这个"日志分离"收益，纯粹是重复等待）。改成
  `cd client-tauri/src-tauri && cargo tauri build`，让 `beforeBuildCommand` 单独负责
  前端这一步。
- **check-desktop-version.ts 只比对"四处"、完全不管 Cargo.lock**：更贴合任务原文的
  "四处不一致即红"措辞，但会放过一个会导致 `cargo build --locked` 真实报错的漂移源。
  改为额外校验 Cargo.lock、单独报错文案，不与"四处"的主报告混在一起，兼顾两边。
- **在 workflow 里对 tauri-action 使用的 GitHub Action 版本做 commit SHA 钉死**（而不是
  `@v1.0.0` 标签）：设计稿本身核实过对应的 commit SHA，安全性更高，但仓库现有
  `verify.yml` 里所有第三方 action（`pnpm/action-setup`、`Swatinem/rust-cache` 等）
  都是标签引用，不是 SHA 钉死；为保持仓库内一致的"钉版本"口径（而不是仅这一个文件
  搞特殊），沿用标签形式。这条留作后续统一收紧的候选，不在本轮单独处理。

## Consequences

- `.github/workflows/desktop-release.yml` 合入 main 后**不会自动跑任何东西**（无
  push/PR 触发），下一步需要用户/协作者先 `gh workflow run desktop-release.yml --ref
  main -f dry_run=true` 干跑一次，逐 job 核实 conclusion，下载四平台产物做真实验收——
  这条尚未执行，是本批最大的遗留项（Windows/Linux 首次真实编译打包，行为完全未知）。
- `pnpm lint`（进而 `pnpm verify`）现在多一步 `pnpm audit:desktop-version`——任何人手改
  四处版本号中的一处而忘了改其它处，CI 会直接红，报错信息里带着 `pnpm sync:desktop-
  version` 这条修复命令。
- 往后任何"这台部署今晚会不会真的发布"之外的版本号读取，都应该认根 package.json，
  不要在别处另起一份判断——`scripts/dev/desktop-version-files.ts` 是唯一的读写实现，
  `check-desktop-version.ts`/`sync-desktop-version.ts` 只是薄封装,新增第五处版本号
  存放点时应该在这个文件里加一个 `DesktopVersionTarget`，而不是在别处重新写一遍
  解析逻辑。
- README/DEPLOY 已经承诺了 Release 资产的具体文件名（`WorkHub_<版本>_<platform>_
  <arch>...`），这是照抄 workflow 里 `releaseAssetNamePattern` 的占位符语义手工推算的，
  **第一次真跑（干跑或正式发布）之后必须回来对照实际产物名校准**——`[platform]`/
  `[arch]` 的实际取值由 tauri-action 决定，不保证跟本文档里手写的字符串完全吻合
  （尤其 Linux 的 arch 可能是 `amd64` 而不是 `x86_64`）。
- CORS 那节文档描述的是"配好之后能工作的状态"，但 CSP（B-1）还没解决，现在读文档的人
  照做也连不上远端服务器——文档里已经用"注意（当前版本的限制）"标注了这一点，B-1 解决
  后要记得回来把这条限制说明删掉。
- 没有接自动更新：已装的桌面客户端不会自己检查/下载新版本，每次发布用户都要手动重新
  下载安装包。
