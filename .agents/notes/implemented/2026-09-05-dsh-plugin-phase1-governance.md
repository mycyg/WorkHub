# 插件治理：装得进来、管得住（阶段 1）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

阶段 0（`2026-09-05-dsh-plugin-host-phase0.md`）把「第三方 dsh 工具型插件能被 Cuu 调到」这条
链路打通了，但「装了哪些插件」只活在一个 env 变量 `WORKHUB_PLUGIN_PATHS` 里。这带来四个具体缺口：

1. **没有清单**：谁都答不上来「这个部署上装了什么」，除非去看服务端的环境变量。
2. **没有启停**：想关掉一个插件只能改 env 再重启整个 API。
3. **没有安装前判断**：阶段 0 的实测里，报告点名的真实插件 `dsh-plugin-finance-data@0.2.0`
   在宿主里加载期直接抛错（它是对着另一个 `@deepseek-ai/dsh-tools` 版本发的）。没有体检，
   用户会遇到「装了三个有两个装不上」，还只能从一段英文堆栈里猜原因。
4. **安装这个动作本身没有审计**：往一台多租户服务器上引入第三方代码，却查不到是谁在什么时候引入的。

而且 dsh 生态里最大的两块（UI Enhancements + Themes，约占策展列表 20%）走的是浏览器侧
第二个 Cordis Context + React + `ctx.slots.register`。WorkHub 全仓零 `.tsx`、桌面端是字符串模板
DOM，这一类**永远**兼容不了——但用户没法从包名看出来，装完只会得到一个「加载成功但什么都没发生」
的空壳。

## Decision

**把插件从一个 env 变量升级成一张可治理的表，并在安装前做一次不执行任何插件代码的静态体检。**

- **迁移 0072 `plugins`**：workspace 围栏、`source_kind` 单值 CHECK（只允许 `local_path`）、
  `status ∈ {installed, load_failed, disabled}`、`compat_report`/`load_report` 两份 jsonb、
  `tool_count`、`installed_by`。`source_kind` 做成 CHECK 而不是「应用层记得校验」：npm 包名 /
  git url / tarball 会在安装期跑包自己的 `prepare`/`postinstall`，那是任何沙箱之外的任意代码执行，
  以后要放开必须走新迁移，改动点显式可查。同一工作区同一目录唯一索引——重复安装是 409，
  不是两条各自启停的记录。
- **静态体检**（`apps/api/src/services/plugin-compat.ts`）只 stat 目录、读 `package.json`，五条规则：

  | id | 判据 | 结论 |
  |---|---|---|
  | `manifest` | 不是本机绝对目录 / 目录不存在 / 无 package.json / JSON 坏 | block |
  | `client_surface` | 有 `dsh.client` | block |
  | `install_scripts` | 有 `preinstall`/`install`/`postinstall`/`prepare` | block |
  | `dsh_tools_peer` | peer 的 `@deepseek-ai/dsh-tools` 范围与宿主捆绑版本不相容 | warn |
  | `bundle_manifest` | 没有 `dsh.bundle.patch` | warn |

  两条 block 的道理各不相同：`dsh.client` 是**结构性不可能**（技术栈不同），
  `prepare`/`postinstall` 是**安装期就跑、宿主 env 白名单管不到**。warn 一律允许尝试——
  静态体检没法预判 `defineTool` 会不会在加载期抛错，说「可能装不上」已经是这一层能诚实给出的
  最强结论。宿主捆绑版本从 `packages/plugin-host` 自己的 `package.json` 现读，不抄常量。
- **安装 = 体检 → 登记 → 试加载**。试加载失败**不是**一次失败的请求：记 `status='load_failed'`
  并把原因留在 `load_report` 里，这条记录照样在列表上。用户看得到原因、能选择移除或修好目录再启用。
- **五个管理员端点**：`GET /api/plugins`、`POST /api/plugins`、`POST /api/plugins/:id/enable|disable`、
  `DELETE /api/plugins/:id`；四个写动作各落一条审计（`plugin.installed`/`enabled`/`disabled`/`removed`）。
  体检拒装的三类各有自己的错误码（`plugin_manifest_unreadable` /
  `plugin_client_surface_unsupported` / `plugin_install_scripts_refused`），两端 UI 据此出**本地化**
  人话，而不是解析英文诊断、也不是把服务端的中文 message 直接当界面文案。
- **宿主按工作区各起一个子进程**，清单 = 引导路径（`WORKHUB_PLUGIN_PATHS`）∪ 该工作区启用的行，
  合并去重。插件是工作区级治理对象，A 工作区装的插件不该出现在 B 工作区的 run 里。活跃宿主数
  有上限（默认 4），超了按最久未用关掉；单工作区部署（常态）永远只有一个子进程。
- **DB 来源是显式接线的**（`usePluginRegistryPathSource()`，只在 `server.ts` 调）。不走 `server.ts`
  的单测与离线工具仍然只认那个 env 变量，一次 PG 查询都不会发生——阶段 0 的「不配插件时零行为
  变化」承诺继续成立。
- **启停/安装/移除后热重载宿主**，并顺手解除崩溃熔断：否则「装了个坏插件把宿主烧了」之后，
  即使把它停用了也永远起不来，只能重启整个 API。
- **桌面端是主场，网页只读**。安装要给一台机器上的**目录绝对路径**——那是「跑着 API 的这台机器」，
  在网页里让人凭空写一个服务器路径既说不清也验不了。桌面设置页有列表 / 启停 / 安装 / 移除，
  启停与移除各自两段确认；网页设置页只渲一份只读清单（名称/版本/状态/工具数/体检提醒），
  动作入口指向桌面客户端。两端的管理员门都是「服务端只给管理员填这个字段」，不是客户端自己猜身份。
- **`source_path` 不进网页 VM**。它是这台服务器上的绝对路径，网页只回答「装了什么、还活着吗」。

## Alternatives considered

- **安装被拒时用 200 + `{installed:false, compat_report}` 回执，好让 UI 渲完整的体检卡。**
  否决：请求说的是「装这个」，没装成就不该是 200。改成 422 + **按检查项分的错误码**——UI 拿码
  出人话，信息量够渲结果卡，也不用给错误信封加一个只有这一处用的 `details` 字段。
- **加一个 `POST /api/plugins/inspect` 预检端点，UI 先看报告再决定装不装。** 否决：两次往返、
  两套状态，而用户真正要的答案（能不能装、为什么）一次安装请求就能给全。
- **一个进程只养一个宿主，按「当前请求的工作区」换清单重启。** 否决：A 工作区的 run 正在调工具时
  B 工作区装配工具会把宿主重启掉，A 的在飞调用直接失败。按工作区分进程换来的是几 MB 内存，
  换掉的是一类只在多租户下才出现、且极难复现的偶发失败。
- **让 `getDefaultPluginHostClient()` 无条件从 DB 读清单。** 否决：不走 `server.ts` 的单测会在每次
  `toolSpecs()` 时尝试连 PG，等一个连接超时。显式接线让「谁开了这个来源」在代码里看得见。
- **静态体检认不出的版本范围默认判为「兼容」。** 否决：那是在假装判断过。返回「说不准」并渲成一条
  诚实的 warn（`unrecognized range …`），用户自己看那两个版本号。
- **把插件目录 `stat` 之外再扫一遍源码找危险 API（`child_process`、`fs`、`net`）。** 否决：
  静态扫描对一行 `eval` 或一次动态 `import()` 就失效，给出的是**虚假的安全感**——比不扫更糟。
  真正的边界是进程隔离与 env 白名单，README 里也照实写明「这是容器，不是沙箱」。

## Consequences

- **兼容面在 README 里有一张表说清楚**：工具类能装；界面/主题类**永远**不能，安装前直接拒绝；
  带安装期脚本的不装；provider / 定时任务 / 面板类排在后面的阶段。同一张表的口径也是安装页的
  错误文案口径——两处不许各说各话。
- **`WORKHUB_PLUGIN_PATHS` 从「唯一来源」降级成「开发/引导来源」，但没有被废弃**：它仍然会被加载，
  且**不在清单里、也不能在界面上启停**。这条差异会在桌面设置页显式写出来（「另有 N 个插件目录来自
  服务端的环境变量」），否则清单看起来像在撒谎。
- **多工作区部署下插件宿主子进程可能有多个**（上限 4，LRU 关闭）。单工作区部署完全无感。
- **`plugins` 表的 `status` 没有 `crashed`**。阶段 0 的崩溃熔断是**整个插件面**级别的（进程内存
  状态），不落库——把它写进某一行会让「这一行坏了」和「宿主整体坏了」混成一件事。
- **仍然没有 capability 声明与逐能力审批**（报告 6.2 那张表）。这一版所有插件工具一律按
  `external_effect` 对待，继承既有的还原点门与人工保留动作拦截。细粒度授权留到后面的阶段。
- **`installed_by` 是 `SET NULL`**：用户被删时这条插件记录还在（它还在跑），但不再指向一个已删的人；
  「谁装的」在 `audit_logs` 里另有不可变的一份。
- **网页端永远不会有安装入口**，除非将来支持了从上传的压缩包安装——那需要另一套安全模型
  （解压位置、体积上限、路径穿越），不在本阶段。
