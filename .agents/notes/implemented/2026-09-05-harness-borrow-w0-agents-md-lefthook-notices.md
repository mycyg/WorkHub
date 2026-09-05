# deepseek-harness 狠借 W0：根 AGENTS.md + lefthook 预提交 + 第三方声明

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R24-H W0 施工工位 wt-l，侦察见 scratchpad/r24-H-deepseek-harness-borrow.md 的 B3/B4/B9 三节）

## Problem

R24-H 侦察对比了 deepseek-harness（MIT，`reference/deepseek-harness`）与本仓在工程纪律上的差距，
列出 12 项「狠借清单」。W0 波次挑了其中三项零冲突、纯加法的地基项：本仓没有根 `AGENTS.md`/
`CLAUDE.md`（事实规约散落在人的记忆和 `CONTRIBUTING.md` 里，AI 协作者每次都要重新摸索）；本仓没有
任何 git hook（"绝不 `git add -A`" 这类纪律只存在于记忆里，提交那一刻没人拦，`pnpm lint` 里的
`audit:*` 门禁要等到手动跑或 CI 才会红）；本仓 17 个 `package.json` 都没有 `license` 字段、没有
`THIRD_PARTY_NOTICES.md`，而仓库是 PolyForm Noncommercial 且已经在借用第三方代码。

## Decision

三件独立加法，全部落地：

1. **根 `AGENTS.md`（67 行）+ `CLAUDE.md` 软链**。内容三段：仓库地图（3 个 app + `client-tauri` +
   13 个 package 各一句话）、必跑门禁（`pnpm typecheck`/`test`/`lint`/`verify` 的组成，cargo 三门
   与 web 路由冒烟的触发时机）、纪律（不 add -A、PG smoke 断言同步、新端点三处联动、i18n 禁黑话禁
   emoji、Agent Note、docs 计数门、生成物重生成而非手改、桌面端真机走查）。评审规则一节挑了
   `packages/AGENTS.md` 里 12 条包作者纪律改写成本仓语境（决策落地在执行者/只在提交点发布状态/
   门禁要验证过能红/给完整结果加限界等），其中「决策在做出它的那个操作里落地」配了本仓正面样本
   `packages/tools/src/registry.ts` 的双重 `canUse`（`visibleFor` 列出时查一次、`execute` 执行时再
   查一次）。全文预算 ≤120 行，写完是 67 行。
2. **lefthook 预提交钩子**（`lefthook.yml` + `scripts/dev/check-staged-paths.ts` +
   `scripts/dev/check-commit-msg.ts`）。`pre-commit` 六件：白空格（`git diff --cached --check`）、
   暂存路径门禁（拒真实 `.env`/密钥形态字符串/`reference/` 路径，逻辑抄自
   `scripts/qa/r2-release-gate-report.ts` 的 `git.no-secret-diff`/`git.no-reference`，从 CI 前移到
   提交时）、`audit:copy-terms`/`audit:agent-notes`/`audit:desktop-version`、第三方声明「重生成而非
   拒绝」（暂存改了依赖清单就重新生成 `THIRD_PARTY_NOTICES.md` 并 `git add`）。`commit-msg` 只拒空/
   纯注释消息，不强制 `Co-Authored-By` trailer。`prepare` 脚本使 `pnpm install` 后自动装钩子，CI 不
   受影响（CI 独立跑 `pnpm lint`，不经过 git hook）。
3. **`THIRD_PARTY_NOTICES.md` 生成器**（`scripts/dev/gen-third-party-notices.ts`）。先盘点本仓「生成
   物」现状：唯一现成的 gen+verify 对是桌面版本号（`sync:desktop-version`/`audit:desktop-version`）；
   docs 计数行（`docs/workhub/README.md`「N 篇文档已落盘」）没有生成脚本，靠人工改；
   `client-tauri/src-tauri/gen/schemas/capabilities.json` 是 Tauri CLI 自己的产物，不归我们管。
   `THIRD_PARTY_NOTICES.md` 于是成为本仓第一个真正的 gen+`--check` 对：扫全部 17 个 workspace
   manifest 的直接外部依赖（16 个，双 devDependency 去重后），从已安装的 `node_modules` 读
   版本/license/repo，按 license 分组（MIT/Apache-2.0/ISC/BSD/未知，未知单列待人工复核）。同批给
   17 个 `package.json` 补 `"license": "PolyForm-Noncommercial-1.0.0"`（与根 `LICENSE` 一致）。文件
   另有「Vendored source」一节指到既有的 `packages/agent/src/loop2/NOTICE.md`（vendor 的 pi，MIT），
   以及「Derived from DeepSeek Harness (MIT)」一节如实登记本轮借了什么：Agent Note 制度、
   `AGENTS.md` 规约（两者都是思想/格式借用，未拷贝代码，不需要署名）；本生成器与 `lefthook.yml`
   的分层结构（代码/配置改写，文件头各自保留 MIT 署名块，写明上游 commit
   `d347e703908d0406b7a7ef80e3a0e594d86b2215`）。`audit:third-party-notices --check` 挂进 `pnpm lint`
   链末尾。

## Alternatives considered

- **lefthook 抄 dsh 全部 5 个 pre-commit job**：翻译配对（`*.i18n.yaml`）、归档 Agent Note 校验、
  暂存 lint（`oxlint --fix`）、vendor manifest 守卫——本仓没有 `*.i18n.yaml` 配对文件、没有
  `archived/` 下需要额外校验的逻辑（`audit:agent-notes` 已覆盖四层生命周期）、没有 linter、没有
  `vendor/` 目录（只有 loop2 下一处 vendor 子目录，不需要独立守卫）。四个都跳过，不为了抄而抄。
- **`THIRD_PARTY_NOTICES.md` 按 runtime/dev-only 分层（dsh 原版做法）**：本仓所有直接依赖都在
  「会被打进产物」的 app/package 里声明（没有 dsh 那种"任何插件都能被 `cordis.yml` 挂载"的运行时
  不确定性），runtime/dev 区分对我们没有实际意义；改成按 license 族分组，更贴合"哪些许可证需要人
  工复核"这个真实决策点。
- **一次性用 `js-yaml` 解析 `pnpm-workspace.yaml`**：本仓 `packages:` 只有三行固定 glob，为此加一个
  新 devDependency 不值得，改用一个窄范围的行锚定正则（解析不到就报错，不静默吞空结果）。

## Consequences

- **本仓第一次有可执行的本地提交门禁**；`pnpm lint` 从 6 个 audit 涨到 7 个（新增
  `audit:third-party-notices`），`AGENTS.md` 的门禁清单同步改了"六件套→七件套"。
- **worktree 与主仓共享 `.git/hooks/` 是已验证到的真实陷阱**：本机 `pnpm install`/`pnpm approve-builds
  lefthook`/`pnpm lefthook run <hook>` 都会把 lefthook 的 hook 触发脚本同步进*共享*的
  `.git/hooks/`（worktree 不是独立的 hooks 目录，除非显式启用 `extensions.worktreeConfig` 并配
  `core.hooksPath --worktree`——这两步本身要写共享 `.git/config`，同样越界，本轮没有做）。施工期间
  两次触发过这个副作用，均已用签名扫描（hook 脚本内含 `call_lefthook` 字符串）清理干净，最终验证
  主仓 `.git/hooks/` 只剩 `*.sample`。**后续任何在 worktree 里验证 lefthook 的施工，一律用
  `node_modules/.bin/lefthook run <hook> --no-auto-install` 直接调二进制**（绕开 `pnpm lefthook`
  这个别名——它即使带 `--no-auto-install` 也可能先触发 pnpm 自己的 `prepare` 生命周期脚本），跑完
  再核一遍共享 hooks 目录。
- **`gen-third-party-notices.ts` 对依赖版本冲突 fail-closed**：同一个外部包被两个 manifest 依赖但
  解析出不同版本时直接抛错，不会静默选一个；目前 16 个外部依赖里 `tsx`/`zod` 各被多处依赖，均验证
  版本一致。未来这类冲突出现时，报错信息会指名两处声明目录，方便定位。
- **该生成器只列直接依赖**（不含传递闭包），`pnpm-lock.yaml` 仍是完整闭包的权威来源，文档正文已
  写明这一点。
- **遗留**：`docs/workhub/README.md` 的文档计数行仍是人工维护（没有稳定的 gen 脚本可归约），已在
  `AGENTS.md` 里写明这条纪律而非假装它是生成物。
