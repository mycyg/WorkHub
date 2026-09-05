# 侦察兵 E：依赖 / 工具链 / CI 健康报告

仓库：`/Users/apple/Desktop/开发项目/WorkHub`（分支 `main-integration`，与 `origin/main` 一致）
环境：Node 22.17.0、pnpm 11.0.9、cargo 1.98.0（`~/.cargo/bin`）
纪律：全程只读，未执行任何 `git` 写操作 / `pnpm install`-`add`-`update` / 未修改仓库文件 / 未跑 test-verify-qa / 未起服务器。

---

## 0. 关键库清单（任务点名的 10 个库，逐一给结论）

| 库 | 当前 | 最新 | 类型 | 结论 |
|---|---|---|---|---|
| typescript | 5.7.2 | 7.0.2 | 主版本落后（且是编译器换代，非普通大版本） | 见 DEP-03，禁止顺手升级 |
| drizzle-orm | 0.44.2 | 0.45.2 | 0.x 位落后，**命中高危 CVE** | 见 DEP-01，立即升级 |
| pg（postgres 驱动） | 8.21.0 | 8.23.0 | 次版本落后 | 无 CVE，安全带过，可批量纳入常规小版本升级 |
| zod | 4.4.3 | 4.5.4 | 次版本落后 | 无 CVE，全仓 7 个包版本号完全一致（`^4.0.1`），无分裂，可放心升 |
| vite | 8.0.16 | 8.2.2 | 次版本落后 | 本身无直接 CVE，但transitively 带出 postcss/nanoid CVE，见 DEP-06 |
| tsx | 4.22.4 | 4.23.13 | 次版本落后 | 版本本身低风险；**但见 DEP-08：它其实是 apps/api 生产运行时的隐性依赖，未在该包声明** |
| esbuild | 三版本并存：0.18.20 / 0.25.4 / 0.28.0 | — | 无包直接声明，全是传递依赖 | 见 DEP-07，dev-server CVE 命中最老的 0.18.20 但实际暴露面很小 |
| hono（HTTP 框架） | 4.12.23 | 4.13.5 | 次版本落后，**命中高危 CVE** | 见 DEP-02，应用层已有缓解但仍建议升级 |
| ioredis | **未使用** | — | — | 项目实际用的是官方 `redis`（node-redis）v5.12.1，不是 ioredis；`redis` 本身无 CVE 命中，但落后一个大版本（→6.2.1），见 DEP-05 |
| @tauri-apps/api | **未使用（非缺陷）** | — | — | `apps/desktop-webview` 不依赖这个 npm 包；`tauri.conf.json` 开了 `withGlobalTauri: true`，源码直接读 `window.__TAURI__`/`__TAURI_INTERNALS__` 全局对象（`apps/desktop-webview/src/desktop-window-controls.ts` 等 20 个文件命中 `__TAURI__`，但零命中字面量 `@tauri-apps/api` 的 import 语句）。已核实 lockfile/node_modules 均无此包，架构选择成立，不是漏装 |

---

## 1. JS 依赖发现

### DEP-01【高】drizzle-orm SQL 注入 CVE，当前版本正中靶心
- **问题**：`packages/db` 声明 `drizzle-orm: "^0.44.2"`，实际解析到 `0.44.2`（`node_modules/.pnpm/drizzle-orm@0.44.2_@types+pg@8.20.0_pg@8.21.0`）。`pnpm audit --audit-level high` 报：
  ```
  high  Drizzle ORM has SQL injection via improperly escaped SQL identifiers
  Vulnerable versions: <0.45.2   Patched versions: >=0.45.2
  Paths: packages__db>drizzle-orm
  https://github.com/advisories/GHSA-gpj5-g38j-94v9
  ```
  `pnpm outdated -r` 确认 latest 正是 `0.45.2`。
- **证据**：`/private/tmp/.../scratchpad/pnpm-audit.txt`；`packages/db/package.json`。
- **建议**：升级 `drizzle-orm` 到 `^0.45.2`+，跑一遍 `pnpm --filter @workhub/db check` + 真 PG smoke（`qa:r1-pg-smoke`/`qa:r2-pg-redis-smoke`，仓库唯一的真库门）。0.x 版本号在 drizzle 的实践里可能带轻微行为变化，升级后建议过一遍 `packages/db` 的既有测试。
- **工作量**：S
- **建议模型**：sonnet

### DEP-02【高】hono CORS 反射 CVE，当前版本命中（应用层已有缓解，仍建议升级）
- **问题**：`hono@4.12.23`（`apps/api` 声明 `^4.8.0`），命中：
  ```
  high  hono: CORS Middleware reflects any Origin with credentials when origin defaults to the wildcard
  Vulnerable versions: <4.12.25   Patched: >=4.12.25
  Paths: apps__api>@hono/node-server>hono, apps__api>hono
  https://github.com/advisories/GHSA-88fw-hqm2-52qc
  ```
- **重要背景（避免误判为"立即可被打穿"）**：`apps/api/src/app.ts:184-199` 已经对这类问题做过一轮修复（注释标注"R2 audit#28"）：当 `CORS_ALLOW_ORIGINS` 配成 `*`（`.env.example:39`、`.env.pilot.example:14` 默认都是 `*`）时，代码**不会**把字面量 `"*"` 传给 `hono/cors`，而是传一个自定义函数，只反射回环地址（`localhost`/`127.0.0.1`/`[::1]` 任意端口）和桌面端 `tauri://localhost`/`tauri.localhost` 来源，其余一律拒绝；同时叠加了 `createSameOriginGuardMiddleware()` 做 CSRF 纵深防御。生产环境下 `validateRuntimeConfig`（`packages/config/src/env.ts`）还会硬性拒绝 `CORS_ALLOW_ORIGINS=*`。
- **结论**：真实可利用性因为这层应用逻辑被大幅降低，但既然 hono 包本身的内部处理仍可能有未知的边界情况，且升级是纯 patch 级操作（`4.12.23→4.13.5`），没有理由不做。
- **建议**：升级 `hono` 到 `^4.13.5`（或至少 `>=4.12.25`），升级后重跑 `qa:r2-pg-redis-smoke`（该 job 覆盖真实 HTTP 请求路径）确认 CORS 行为无回归。
- **工作量**：S
- **建议模型**：sonnet

### DEP-03【高】TypeScript 5.7.2 → 7.0.2：这是编译器换代，不是普通升级
- **问题**：`pnpm outdated -r` 显示 root devDependency `typescript(dev) 5.7.2 → 7.0.2`。TS 从 5.x 直接跳到 7.0（跳过 6.x 编号）对应的是 Microsoft 的原生（Go 移植）编译器换代，不是一次常规的次版本迭代。
- **为什么值得单独拎出来**：`tsconfig.base.json` 全仓开着 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`（较激进的严格集），16 个包各自独立 `tsc -p tsconfig.json --noEmit`（见 TS-01），`tsx`（用于 `apps/api`/`apps/desktop-webview` 的开发与生产运行，见 DEP-08）、`vite`、`drizzle-kit` 等工具链对新编译器的兼容状态目前未知。盲目跟随"latest"大概率会在严格模式的边界行为上炸出一批新错误，或工具链直接不兼容。
- **建议**：不要在常规依赖批量升级里顺带做这个。单开一个评估任务：在隔离分支/worktree 里把 `typescript` 换成 7.0.2，跑一遍 `pnpm -r typecheck`，记录差异；同时确认 `tsx`/`vite`/`drizzle-kit` 官方是否已声明支持 TS7。评估通过后再决定升级窗口。
- **工作量**：L
- **建议模型**：opus（需要读懂 TS7 变更范围、判断对 16 个包的影响面，属于评估型任务）

### DEP-04【中】React 18 → 19 落后一个大版本
- **问题**：`apps/web/package.json` 精确锁定 `react: 18.3.1`、`react-dom: 18.3.1`（非 `^` range），`@types/react: 18.3.24`、`@types/react-dom: 18.3.7`。`pnpm outdated -r` 显示四者均可到 19.x。
- **建议**：React 19 有断裂性变更（ref 作为普通 prop、函数组件 `defaultProps` 移除等），需要专门迁移任务：读官方迁移指南 → 升级 → 跑 `apps/web` 现有测试与 `qa:r4-web-*` 系列 → 视觉回归。不建议顺带升级。
- **工作量**：L
- **建议模型**：opus

### DEP-05【中】redis 客户端与 @hono/node-server 均落后一个大版本
- **问题**：`redis`（node-redis 官方客户端，`apps/api` 用于 `BROKER_BACKEND=redis` 路径）`5.12.1 → 6.2.1`；`@hono/node-server` `1.19.14 → 2.1.1`。`pnpm audit` 未对这两者报出已知 CVE，纯粹是版本落后。
- **建议**：分别过一遍两者 CHANGELOG 确认 API 断裂点，在隔离分支升级后完整跑一次 `qa:r2-pg-redis-smoke`（唯一覆盖 `BROKER_BACKEND=redis` 路径的真实 PG+Redis 门）确认无回归。两者可以合并成一个升级批次因为都影响 `apps/api` 的服务端路径。
- **工作量**：M
- **建议模型**：sonnet

### DEP-06【低】安全的小版本批量升级候选
- **问题**：`pg`（8.21.0→8.23.0）、`zod`（4.4.3→4.5.4，全仓 7 个包版本一致，无分裂）、`vite`（8.0.16→8.2.2）、`tsx`（4.22.4→4.23.13）、`@types/pg`（8.20.0→8.23.1）均为次版本落后且 `pnpm audit` 未直接点名。**注意**：`pnpm audit` 报的 postcss/nanoid 高危项都挂在 `vite>postcss`/`vite>postcss>nanoid` 下（见 DEP-06 附注），升级 vite 到 8.2.2 后需要重新跑一次 `pnpm audit` 确认这两条是否已随之解决（vite 8.2.2 是否内部提升了 postcss/nanoid 的 pin 需要实际升级后验证，本次未验证）。
- **建议**：作为一个常规批次（非紧急）一起处理，升级后跑 `pnpm -r typecheck && pnpm -r test`。
- **工作量**：S
- **建议模型**：sonnet

### DEP-07【低】esbuild 三版本并存，根源是 drizzle-kit 依赖的已废弃 @esbuild-kit/esm-loader
- **问题**：`node_modules/.pnpm` 与 `pnpm-lock.yaml` 里 esbuild 同时有 `0.18.20`/`0.25.4`/`0.28.0` 三个版本。追踪依赖边（`pnpm-lock.yaml`）：
  - `esbuild@0.18.20` ← `@esbuild-kit/esm-loader@2.6.5` ← `drizzle-kit@0.31.10`
  - `esbuild@0.28.0` ← `vite@8.0.16` 直接使用
  `drizzle-kit@0.31.10` 是该包当前已发布的最新版（`pnpm outdated -r` 没有把 `drizzle-kit` 列进落后清单），说明这条过时依赖链目前不可通过升级 `drizzle-kit` 自行消除，要等上游放弃 `@esbuild-kit`（该项目已被官方标记为废弃/合并进 tsx）。
- **风险评估**：`pnpm audit` 报的 esbuild dev-server CVE（`<=0.24.2` 受影响，`0.18.20` 命中）本质是"任意网站可以向本地 esbuild dev server 发请求"，但 `@esbuild-kit/esm-loader` 在这里只是给 `drizzle-kit` CLI 加载 `drizzle.config.ts` 用，从不起 HTTP serve；真正会起 dev server 的是 `vite`，它用的 `0.28.0` 早已过线。**实际暴露面很小**，优先级放低。
- **建议**：暂不可操作，记录到位；定期检查 `drizzle-kit` release notes 是否摘掉了 `@esbuild-kit` 依赖。
- **工作量**：S（跟踪），实际解决 L（等上游）
- **建议模型**：sonnet

### DEP-08【高】apps/api 的生产 `start` 隐性依赖未声明的 `tsx`；"build" 脚本实际不产出任何编译产物
- **问题**（多点串联，建议整体读）：
  1. `apps/api/package.json` 的 `"start": "node --import tsx src/server.ts"`（以及 `dev`/`test`/13 个 `qa:*` 脚本）大量使用 `tsx`，但该文件 `dependencies`/`devDependencies` 里**完全没有 `tsx` 这个键**（已用 `grep -n "tsx" apps/api/package.json` 核实，只在 `scripts` 段出现）。
  2. 全仓搜索确认：**只有根 `package.json`** 把 `tsx`（`^4.19.2`）声明为 devDependency；`apps/*`、`packages/*` 没有一个包自己声明它。
  3. `apps/api/node_modules/.bin/tsx` **不存在**——证实这个子包本地压根没有落地 `tsx`，完全靠 Node 的模块解析往上层目录找到仓库根的 `node_modules/tsx`。
  4. `apps/api` 的 `"build": "tsc -p tsconfig.json --noEmit"` ——`--noEmit` 意味着这个"build"脚本**不产出任何 `dist/` 编译文件**，本质是 `typecheck` 的同义脚本。生产环境跑的从来都是 `src/*.ts` 源码，经 `tsx`（内部用 esbuild）实时转译，不是预编译产物。
  5. `Dockerfile` 是单阶段构建：`COPY . .` 后 `pnpm install --frozen-lockfile --offline`，**没有** `--prod`、没有 `pnpm deploy`、没有任何 prune devDependencies 的步骤——这正是当前链路"恰好还能跑"的原因：根目录完整 node_modules（含 `tsx`）被原样打进镜像，Node 向上找 `tsx` 能找到。
- **为什么是"高"优先级而不是无所谓**：这是一个**潜伏风险**——如果日后有人（很自然地）想优化镜像体积去裁剪 devDependencies（这正是本报告 DOCKER-01 会建议的方向），会在不知情的情况下**直接打断生产环境的 `start`**，因为 `tsx` 会被当作"只是开发工具"一起裁掉。两个改动必须绑定一起看。
- **建议**（二选一）：
  - (a) 短期：把 `tsx` 提升为 `@workhub/api`（以及同样用 `node --import tsx --test` 的 `@workhub/desktop-webview`）自己的显式 `dependencies`，不要只靠根 devDependency 兜底。
  - (b) 根治：让 `apps/api` 的 `build` 真正跑 `tsc`（去掉 `--noEmit`，走 `outDir: dist`）编译出 JS，`start` 改成 `node dist/server.js`，彻底摆脱生产环境对源码转译器的依赖——这样镜像也能安全裁剪 devDependencies，启动更快，攻击面更小。
- **工作量**：M（涉及两个 app 的脚本、tsconfig、Dockerfile CMD 联动，需要重新在容器里验证跑通）
- **建议模型**：sonnet

### DEP-09【信息/阴性对照】未发现明显未使用依赖
- **方法**：对每个 workspace 包的 `dependencies`+`devDependencies`（剔除 `workspace:*`）在其自身 `src/`（含测试文件）全文做子串匹配。
- **结果**：唯三"零命中"的是 `@types/react`、`@types/react-dom`（`apps/web`）、`@types/pg`（`packages/db`）——这三个是纯类型包，TypeScript 通过隐式类型解析消费 `react`/`react-dom`/`pg` 的类型声明，从不会出现显式 `import "@types/xxx"` 语句，**不是**真的未使用。`drizzle-kit` 同理通过 CLI（`drizzle-kit generate/check`）而非 JS import 使用，已核实 `packages/db/package.json` 的 `generate`/`check` 脚本调用了它。
- **结论**：本仓库没有明显的"声明了但零使用"的依赖包袱。
- **工作量**：-
- **建议模型**：-

### DEP-10【低】`pnpm-workspace.yaml` 声明的 `workers/*` workspace glob 对应目录不存在
- **问题**：`pnpm-workspace.yaml` 的 `packages:` 列表里有 `"workers/*"`，但仓库根本没有 `workers/` 目录（`ls workers` → No such file or directory）。
- **建议**：要么是给未来子系统预留的占位（若是，建议加注释说明意图），要么是死配置可以删除；现状不影响功能（pnpm 对不存在的 glob 静默忽略），纯粹是可读性/意图清晰度问题。
- **工作量**：S
- **建议模型**：sonnet

---

## 2. Rust（client-tauri/src-tauri）

### RUST-01【高】window-vibrancy / reqwest 版本分裂可以用两行 Cargo.toml 修改一次性收敛一大串重复 crate
- **问题**：`Cargo.toml` 显式锁 `reqwest = "0.12"`、`window-vibrancy = "0.5"`，但 `tauri = "2.11.2"` 自己内部依赖的是 `reqwest 0.13.4` 和 `window-vibrancy 0.6.0`（用脚本解析 `Cargo.lock` 的依赖边确认：`tauri 2.11.2 -> dep entry: 'reqwest 0.13.4'`、`tauri 2.11.2 -> dep entry: 'window-vibrancy 0.6.0'`）。这导致：
  - `reqwest` 在 lockfile 里有 `0.12.28` 和 `0.13.4` 两份。
  - `window-vibrancy` 有 `0.5.3`（本项目直接依赖）和 `0.6.0`（tauri 间接依赖）两份；旧的 `0.5.3` 又拖出整条旧的 `objc2 0.5.x` 家族：`objc2`、`objc2-app-kit`、`objc2-core-data`、`objc2-core-image`、`objc2-foundation`、`objc2-metal`、`objc2-quartz-core`、`block2` —— **8 个 crate** 因为这一个版本号的原因而重复（新的 `objc2-app-kit 0.3.2` 已经在本项目 `[target.'cfg(target_os = "macos")'.dependencies]` 里被直接使用）。
- **证据**：`client-tauri/src-tauri/Cargo.toml`；`client-tauri/src-tauri/Cargo.lock`（542 个 package 条目里 46 个名称有版本分裂，脚本统计+依赖边追踪见本次侦察过程）。
- **建议**：把 `reqwest = "0.12"` 改成 `"0.13"`、`window-vibrancy = "0.5"` 改成 `"0.6"`，让直接依赖和 tauri 内部需要的版本对齐，`cargo update` 后大概率能让 `reqwest`/`window-vibrancy`/整条 `objc2 0.5.x` 家族/`block2` 全部收敛成单一版本。**因为 `window-vibrancy` 是原生窗口毛玻璃效果的核心库（本机记忆库明确记录过它很"finicky"，桌面 HudWindow 的 vibrancy 效果全靠它），升级后必须在真机 macOS 上重新目测验证毛玻璃效果没有回归**，不能只看编译通过。
- **工作量**：S（改动本身）/ 需要 M 级验证（真机视觉验收）
- **建议模型**：sonnet

### RUST-02【低】Cargo.lock 里 46/476（约 10%）crate 名称存在版本分裂，windows-sys 系列最严重
- **问题**：脚本统计 `Cargo.lock`：542 个 `[[package]]` 条目，476 个唯一 crate 名，46 个名称有 >1 个版本共存。除 RUST-01 已处理的 window-vibrancy/reqwest/objc2 家族外，最重的是 Windows 互操作系列：`windows-sys`（5 个版本：0.45.0/0.52.0/0.59.0/0.60.2/0.61.2）、`windows-targets` 与各 `windows_*_gnu`/`windows_*_msvc` 平台子包（各 3 个版本）；另外 `syn`（1.x+2.x）、`bitflags`（1.x+2.x）、`toml`/`toml_edit`/`winnow`（多代共存）、`thiserror`（1.x+2.x）等是 Rust 生态里几乎不可能靠单个项目对齐消除的普遍性分裂（不同上游 crate 各自选择了不同大版本）。
- **建议**：这类记录在案即可，优先级明显低于 RUST-01（本项目自己可控、两行改动就能收敛一串），不建议专门花时间处理生态级分裂。
- **工作量**：S（记录），真正收敛 L 且大部分不可控
- **建议模型**：sonnet

### RUST-03【信息/阴性对照】直接依赖使用性抽检全部通过
- **方法**：对 `Cargo.toml` 里每一个直接依赖的 crate 名在 `src/`+`build.rs` 里做出现次数抽检（非 `cargo-udeps` 级别的严格分析，仅作为读性抽检）。
- **结果**：`futures_util`/`reqwest`/`serde`/`serde_json`/`tauri`/`tauri_runtime`/`tauri_plugin_deep_link`/`tauri_plugin_global_shortcut`/`tauri_plugin_notification`/`tauri_plugin_single_instance`/`tokio`/`url`/`window_vibrancy`/`objc2_app_kit` 全部至少命中 1 个文件，没有发现明显未使用的直接依赖。
- **其他基本信息**：`edition = "2021"`（未跟进到 2024 edition，非紧急）；`tauri`/`tauri-runtime` 主版本 v2（`2.11.2`），`tauri-build` `2.6.2`；插件版本锁定粒度不统一——`tauri-plugin-global-shortcut = "2.3.2"` 锁到具体 patch，而 `tauri-plugin-deep-link`/`tauri-plugin-notification`/`tauri-plugin-single-instance` 只写裸 `"2"`（相当于 `^2.0.0`，允许任意 2.x 更新）——这本身不是 bug（`Cargo.lock` 仍会钉死实际解析版本），只在 lockfile 被删除重建时才有意义，优先级低，可选择性统一写法。
- **工作量**：-
- **建议模型**：-

---

## 3. TypeScript 配置

### TS-01【中】16 个包各自独立 `tsc`，无 project references / incremental，类型检查有重复开销
- **问题**：全仓 16 个 `tsconfig.json`（`apps/api`、`apps/web`、`apps/desktop-webview`、`packages/*` 13 个）没有一个设置 `composite`/`incremental`/`references`（`grep -rl` 全仓确认零命中）。`tsconfig.base.json` 的 `paths` 把 `@workhub/*` 直接指向各包的**源码入口**（如 `"@workhub/config": ["packages/config/src/index.ts"]`），不是编译产物 `.d.ts`。每个包的 `"typecheck"` 脚本都是独立的 `tsc -p tsconfig.json --noEmit`（16 个包逐一确认）。
- **影响**：`pnpm -r typecheck`（CI `workspace` job 里 `pnpm verify` 的一部分）对每个下游包都要从源码重新解析并类型检查它依赖的全部上游 `@workhub/*` 包，没有 `.tsbuildinfo` 缓存复用；依赖链越深（如 `apps/api` 依赖 9 个 `@workhub/*` 包）重复开销越大。
- **建议**：评估引入 TypeScript project references（`composite: true` + `references` 数组 + `tsc -b`），或至少给各包开 `incremental: true` 并在 CI 里用 `actions/cache` 缓存各自的 `.tsbuildinfo`。这是一个纯工具链改造，收益是 CI/本地 typecheck 时间下降，但要先验证 16 个包改造后全部类型检查结果一致（不会因为增量/引用机制引入误判）。建议与 DEP-03（TS7 评估）分开做，避免两个变量一起改动难以定位问题。
- **工作量**：M
- **建议模型**：sonnet

### TS-02【信息/阴性对照】各包 tsconfig 一致性良好
- **方法**：逐一读取全部 16 个 `tsconfig.json`。
- **结果**：全部正确 `"extends": "../../tsconfig.base.json"`，没有一个包放松/覆盖 `strict`/`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` 等基础严格项；`apps/web`、`apps/desktop-webview` 一致地加了 `DOM`/`DOM.Iterable` lib 和 `vite/client` 类型；`packages/config`、`packages/contracts` 一致地加了 `declaration: true`（供其他包消费类型）。没有发现配置漂移。
- **工作量**：-
- **建议模型**：-

---

## 4. CI（`.github/workflows/verify.yml`，仓库唯一的 workflow 文件）

全仓只有一个 workflow 文件，共 **8 个 job**：`workspace`（`pnpm verify` = typecheck+test+lint）、`web-live-route-smoke`、`rust-system-i18n`（cargo fmt/clippy，装 Tauri Linux 系统依赖）、`r1-pg-smoke`、`r2-pg-redis-smoke`、`pilot-stack-smoke`（docker compose 全栈构建+健康检查+沙箱库冒烟）、`security-advisory`（`continue-on-error: true`，`pnpm audit`+私钥扫描，非阻断）、`migration-audit`。8 个 job 之间没有 `needs:` 依赖，默认全部并行跑（这点已经是好的实践，wall-clock 时间不受影响，只是并发消耗的 runner 分钟数更多）。

### CI-01【中】缺 concurrency 分组 + 8 个 job 里有 6 个没设 timeout-minutes
- **问题**：
  1. 全文件 `grep "concurrency"` 零命中——同一个 PR 连续推送新 commit 时，前一轮还在跑的 8 个 job **不会被自动取消**，会一直跑到完成或超时。`pilot-stack-smoke` 这个最贵的 job（`timeout-minutes: 25`，要整跑一次 `docker compose up -d --build`，且没有配 Docker layer 缓存）尤其浪费。
  2. `timeout-minutes` 只在 `web-live-route-smoke`（15）和 `pilot-stack-smoke`（25）两处设置；`workspace`、`rust-system-i18n`、`r1-pg-smoke`、`r2-pg-redis-smoke`、`security-advisory`、`migration-audit` 六个 job 都没有，意味着一旦某一步卡住（比如 PG 健康检查重试逻辑失效、某个测试挂死），会一直占用 runner 直到 GitHub 默认的 360 分钟 job 上限才被强制杀掉。
  3. 没有用到 `strategy.matrix`，所以 `fail-fast` 这个配置项在当前 workflow 里无意义（没有矩阵可言，不是遗漏）。
- **建议**：
  - 在 workflow 顶层加 `concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true }`。
  - 给剩余 6 个 job 补 `timeout-minutes`（`workspace` 因为要跑完整 `pnpm verify` 建议给 15-20；`r1-pg-smoke`/`r2-pg-redis-smoke`/`migration-audit` 这类有 PG/Redis 健康检查重试循环的建议给 10；`rust-system-i18n`/`security-advisory` 建议给 10）。
- **工作量**：S
- **建议模型**：sonnet

### CI-02【低】本地 `pnpm verify` 与 CI `workspace` job 对 Rust 部分的覆盖口径不对等（workflow 注释已自述原因，建议补充到贡献者文档）
- **问题**：`workspace` job 显式设了 `WORKHUB_RUST_I18N_CARGO: skip`（YAML 注释自述："cargo gate 运行在专门的 rust-system-i18n job with Tauri system deps"），也就是说 CI 的 `workspace` job 跑 `pnpm verify` 时，`lint` 步骤里的 `qa:r4-rust-system-i18n` 脚本**不会真的执行 cargo 命令**；真正的 `cargo fmt --check`/`cargo clippy -D warnings` 被挪到独立的 `rust-system-i18n` job（先装好 Tauri 的 Linux 系统依赖 `libwebkit2gtk`/`libgtk-3`等）里单独跑。但开发者在本机跑 `pnpm verify` 时**默认不会带这个环境变量**，会尝试直接跑 cargo——`rust-system-i18n` job 自己的注释也承认："clippy 是真编译再 lint……macOS/Windows 专属分支的 clippy 仍需在对应平台本机跑"。也就是说：本地 `pnpm verify` 全绿不能 100% 保证等价于 CI 全绿（反之亦然），尤其是 Rust 平台专属分支（`windows.rs`/`main.rs` 里 `#[cfg(target_os = "macos"/"windows")]` 门下的代码，Linux CI 编译时直接被裁掉、clippy 覆盖不到）。
- **CI 独有、本地 `pnpm verify` 完全不触达的门**：`web-live-route-smoke`、`r1-pg-smoke`、`r2-pg-redis-smoke`、`pilot-stack-smoke`、`migration-audit` 五个 job 都需要真实 PG/Redis/Docker，开发者本机要自建这些依赖服务才能等价复现（据本机既有实践，本地有 PG 容器可用于类似验证）。
- **建议**：这是既有设计取舍，workflow 注释已经写明原因，**不算 bug**；建议在 `CONTRIBUTING.md` 里显式提一句"本地 `pnpm verify` 全绿不完全等价于 CI 全绿：Rust 平台专属分支的 clippy 覆盖、以及 5 个需要真实 PG/Redis/Docker 的 smoke job，都需要额外本机环境才能复现"，降低贡献者的误判成本。
- **工作量**：S（纯文档）
- **建议模型**：sonnet

---

## 5. 容器与部署

### DOCKER-01【中】Dockerfile 单阶段构建，不裁剪 devDependencies，不切非 root 用户，基础镜像用浮动 tag
- **问题**：
  1. `Dockerfile` 全文只有一个 `FROM node:22-slim` stage（无 builder/runtime 分离）。`COPY . .` 之后 `RUN pnpm install --frozen-lockfile --offline && pnpm --filter @workhub/web build`——没有 `--prod`、没有 `pnpm deploy`、没有任何裁剪 devDependencies 的步骤，意味着最终镜像里 `typescript`/`tsx`/`vite`（devDeps）等构建期工具全部随生产镜像一起发布（**这也正是 DEP-08 那个隐性 `tsx` 依赖当前能跑通的原因，两者要一起改**）。
  2. 没有 `USER` 指令切换到非 root——`node:22-slim` 官方镜像自带一个 `node` 用户可以直接 `USER node`，当前没有用，容器进程默认以 root 运行。
  3. `FROM node:22-slim` 是浮动 tag（跟随 `node:22` 系列滚动更新），没有钉到具体 patch 版本或 digest，构建结果会随时间隐式漂移，不利于可复现构建。
  4. 没有 Dockerfile 层面的 `HEALTHCHECK`（当前健康检查定义在 `docker-compose.pilot.yml` 的 `workhub` 服务里，用 `node -e "fetch(...)"` 实现——这对 compose 编排场景是够用的，只在有人脱离 compose 单独 `docker run` 这个镜像时才会缺健康检查，优先级低于前三条）。
- **建议**：
  - 评估多阶段构建（builder 阶段装完整 devDependencies 跑 build，runtime 阶段只拷贝 `dist/`+生产 `node_modules`）——**前提是先完成 DEP-08 的根治方案**（`apps/api` 真正编译到 `dist/` 并把 `start` 改成跑编译产物），否则裁剪 devDeps 会直接打断生产启动。
  - 加 `USER node`。
  - 把基础镜像钉到具体版本（如 `node:22.17.0-slim`）或 digest，配合定期人工/工具（Renovate/Dependabot）滚动升级而不是隐式漂移。
- **工作量**：M
- **建议模型**：sonnet

### DOCKER-02【低】`.env.pilot.example` 相比 `.env.example` 精简了一批业务可调参数
- **问题**：对比两份 example 文件的顶层变量名，只在 `.env.example`（开发模板）出现、`.env.pilot.example`（试运行模板）完全不提（连注释占位都没有）的包括：`BUDGET_DEFAULT_*`（10 个预算相关变量）、`AGENT_RUN_HEARTBEAT_INTERVAL_MS`/`AGENT_RUN_LEASE_MS`/`AGENT_RUN_MAX_RECOVER_ATTEMPTS`/`AGENT_RUN_PROJECT_HYDRATE_*`/`AGENT_RUN_RECOVERY_INTERVAL_MS`/`AGENT_RUN_SKILL_CURATION_*`（7 个 agent-run 调优变量）、`SESSION_ABSOLUTE_TTL_HOURS`/`SESSION_IDLE_TTL_HOURS`、`DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/`DB_POOL_TIMEOUT`、`AUTH_MODE`、`DEFAULT_ORG_ID`/`DEFAULT_WORKSPACE_ID`、`LLM_PROVIDER_DEFAULT`、`PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK`/`PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK`、`DOWNLOADS_DIR`。
  - 需要澄清：容器化拓扑相关的变量（`APP_ENV`、`DATABASE_URL`、`BROKER_BACKEND`/`BROKER_URL`、`DATA_DIR`、`API_HOST`/`PORT`）**本来就该**由 `docker-compose.pilot.yml` 的 `environment:` 段硬编码接管，不出现在 `.env.pilot.example` 是正确设计，不算问题。
  - 另外 `LLM_BASE_URL`/`LLM_MODEL`/`LLM_MAX_TOKENS_PER_STEP`/`WORKER_COUNT`/`LOG_FORMAT`/`GITHUB_TOKEN_ENC_KEY` 实际上**有**以注释形式（`# VAR=value`）保留在 `.env.pilot.example` 里并配了说明，只是默认注释掉——这部分核实后发现比初看更完善，不算缺口。
  - 真正完全缺席（连注释都没有）的是上面列出的预算/agent-run 调优/会话 TTL/DB 连接池这几类。
- **建议**：优先级低，这更可能是"pilot 走够用默认、不建议动"的有意精简。如果希望试运行方更容易发现这些开关存在，可以在 `DEPLOY.md` 补一句"预算/会话 TTL 等高级参数默认值见 `packages/config/src/env.ts`，如需覆盖参考 `.env.example` 对应变量名"。
- **工作量**：S
- **建议模型**：sonnet

### DOCKER-03【信息/阴性对照】DEPLOY.md 与 compose/env.ts 的关键断言逐一核实，未发现文档漂移
- **方法**：通读 `DEPLOY.md`（146 行）逐条对照实际文件。
- **核实结果**：
  - §4 引用的 `scripts/ops/backup-pg.sh` 确实存在。
  - §7 引用的"生产环境下 `WORKER_COUNT>1` 配 `BROKER_BACKEND=memory` 直接拒绝启动"守卫，在 `packages/config/src/env.ts:438-439` 精确存在：`if (value.workerCount > 1 && value.broker.backend === "memory") { throw new Error("BROKER_BACKEND=memory cannot be used with multiple workers in production"); }`。
  - §3.3 描述的 `GITHUB_TOKEN_ENC_KEY` 默认不在 `.env.pilot.example` 里（需要手工加一行）与实际文件一致。
  - `docker-compose.yml`（开发用，仅 PG/Redis）vs `docker-compose.pilot.yml`（全栈）的差异符合文件头注释所述的设计意图；`pilot.yml` 里 postgres/redis 不对外发布端口（比 dev 版更收紧），是有意的安全加固而非疏漏。
  - `DEPLOY.md` 末尾自己说明"CI 中的 `pilot-stack-smoke` job 对本部署包做真实验证……文档与编排若 drift，CI 会先红"——即该文档本身有 CI 兜底防漂移机制。
- **结论**：文档质量高，未发现需要修正的不一致。
- **工作量**：-
- **建议模型**：-

---

## 6. 安全姿态快检

### SEC-01【信息】SECURITY.md 存在且内容完整
`SECURITY.md`（2748 字节）中英双语，明确了支持范围（源码+`docker-compose.pilot.yml`/`.env.pilot.example` 描述的标准部署形态）、报告渠道（邮件+`[SECURITY]`标题）、响应时限（3 个工作日确认、10 个工作日初步评估）、协调披露承诺。无需处理。

### SEC-02【信息】未发现真实密钥/私钥泄漏
`grep -RnE 'sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN' .`（排除 `node_modules`/`.git`，再排除 `.example`/`test`/`fixture`/`mock`/`SECURITY.md`/`verify.yml` 命中的正常提及）**零命中**。CI 里 `security-advisory` job 本身也有一道等价的私钥头扫描（`continue-on-error: true`，非阻断）。

### SEC-03【信息】`client-tauri/src-tauri/tauri.conf.json` CSP 配置基本扎实，一处宽松点有合理理由
```
default-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;
script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'
```
- `script-src 'self'`（无 `unsafe-inline`/`unsafe-eval`，无远程脚本源）、`object-src 'none'`、`frame-ancestors 'none'` 都是好的硬化项。
- `style-src 'self' 'unsafe-inline'` 允许内联样式，是常见且风险相对较低的权衡（样式注入的危害远小于脚本注入）。
- 相对宽松的是 `connect-src` 里 `http(s)://127.0.0.1:*`/`localhost:*` 任意端口放行——对一个要连本机可变端口 API daemon 的桌面壳这是合理需求，但确实意味着"本机任何端口起的服务"都在可连接范围内。因为 `script-src` 仍然锁 `'self'`，攻击者要先有其他途径注入脚本才谈得上利用这条，实际风险可控。
- 无需处理，记录供将来参考；如果想进一步硬化可以考虑加 `require-trusted-types-for 'script'`（现代浏览器特性，锦上添花，不紧急）。

---

## 附：本次侦察产生的原始数据文件
- `pnpm-outdated.txt`：`pnpm outdated -r` 全量输出
- `pnpm-audit.txt`：`pnpm audit --audit-level high` 输出（5 高危详情）
- `pnpm-audit-full.txt`：`pnpm audit`（无级别过滤）输出，20 条完整列表（2 低/13 中/5 高）
